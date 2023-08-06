package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-sdk-go/service/kinesis"
	"github.com/chromedp/cdproto/network"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/chromedp/chromedp"
)

type Task struct {
	ShouldEnd       bool          `json:"shouldEnd"`
	Report          bool          `json:"report"`
	Name            string        `json:"name"`
	Version         string        `json:"version"`
	TaskId          string        `json:"taskId"`
	Type            string        `json:"type"`
	Client          int           `json:"client"`
	URL             string        `json:"url"`
	Method          string        `json:"method"`
	Compute         string        `json:"compute"`
	Kds             string        `json:"kds"`
	Qps             *int          `json:"qps"`
	N               *int          `json:"n"`
	C               int           `json:"c"`
	EnvInitDuration int64         `json:"envInitDuration"`
	Latency         int64         `json:"latency"`
	Delay           *int          `json:"delay"`
	Regions         []string      `json:"regions"`
	Region          string        `json:"region"`
	NPerClient      *int          `json:"nPerClient"`
	Timeout         time.Duration `json:"timeout"`
	SuccessCode     int           `json:"successCode"`
	StartTime       string        `json:"startTime"`
	CreatedAt       string        `json:"createdAt"`
	EndTime         string        `json:"endTime"`
	States          interface{}   `json:"states"`
	Status          string        `json:"status"`
}

func UnmarshalTask(data string) (Task, error) {
	fmt.Println(data)
	var task Task
	err := json.Unmarshal([]byte(data), &task)
	if err != nil {
		return Task{}, err
	}
	return task, nil
}

func main() {
	envJson := os.Getenv("TASK")
	if envJson == "" {
		lambda.Start(HandleSNSEvent)
	} else {
		ProcessTask(envJson)
	}
}

func HandleSNSEvent(ctx context.Context, snsEvent events.SNSEvent) error {
	for _, record := range snsEvent.Records {
		ProcessTask(record.SNS.Message)
	}
	return nil
}

func ProcessTask(data string) {

	task, err := UnmarshalTask(data)

	if err != nil {
		fmt.Println(err)
		return
	}

	creationTime, err := time.Parse(time.RFC3339, task.CreatedAt)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	task.EnvInitDuration = time.Since(creationTime).Milliseconds()
	fmt.Printf("Task Environment Init Duration %d ms\n", task.EnvInitDuration)

	startTime, err := time.Parse(time.RFC3339, task.StartTime)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	for time.Now().Before(startTime) {
		time.Sleep(1 * time.Millisecond)
	}
	task.Latency = time.Since(startTime).Milliseconds()
	fmt.Printf("Task Latency %d ms\n", task.Latency)

	var endTime *time.Time
	if task.EndTime != "" {
		t, err := time.Parse(time.RFC3339, task.EndTime)
		if err != nil {
			fmt.Println("Error:", err)
			return
		}
		endTime = &t
	}

	if task.URL != "" {
		if task.Qps != nil {
			for {

				var wg sync.WaitGroup
				for i := 0; i < *task.Qps; i++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						FetchAndMeasure(task)
					}()
				}
				wg.Wait()

				time.Sleep(time.Second)
				if endTime != nil && time.Now().After(*endTime) {
					break
				}
			}
		} else if task.N != nil {
			for i := 0; i < *task.NPerClient; i++ {
				FetchAndMeasure(task)
			}
		}
	} else {
		fmt.Println("URL does not exist in JSON or is not a string")
	}

}

func FetchAndMeasure(task Task) {

	task.Timeout *= time.Millisecond

	if task.Type == "API" {
		FetchAndMeasureApi(task)
	}

	if task.Type == "HTML" {
		FetchAndMeasureHtml(task)
	}

}

func ua(task Task) string {
	return "SFB/" + task.Version + "/" + task.Region + " (" + task.Compute + ") TaskId=" + task.TaskId + " EnvInitDuration=" + strconv.FormatInt(task.EnvInitDuration, 10) + "ms" + " Latency=" + strconv.FormatInt(task.Latency, 10) + "ms"
}

func FetchAndMeasureApi(task Task) {
	ctx, cancel := context.WithTimeout(context.Background(), task.Timeout)
	defer cancel()

	start := time.Now()

	req, _ := http.NewRequest(http.MethodGet, task.URL, nil)
	req.Header.Set("User-Agent", ua(task))
	req = req.WithContext(ctx)
	resp, err := http.DefaultClient.Do(req)

	if err != nil {
		fmt.Println(err)
		return
	}
	defer resp.Body.Close()

	duration := time.Since(start)

	fmt.Printf("%s %d %s", task.URL, resp.StatusCode, duration)

	Report(task)
}

func Report(task Task) {
	if task.Report != true {
		return
	}

	sess := session.Must(session.NewSession(&aws.Config{
		Region: aws.String(task.Region),
	}))

	svc := kinesis.New(sess)

	data, err := json.Marshal(task)
	if err != nil {
		panic(err)
	}

	input := &kinesis.PutRecordInput{
		Data:         data,
		StreamName:   aws.String(task.Kds),
		PartitionKey: aws.String("taskId"),
	}

	_, err = svc.PutRecord(input)
	if err != nil {
		panic(err)
	}
}

func FetchAndMeasureHtml(task Task) {
	ctx, cancel := context.WithTimeout(context.Background(), task.Timeout)
	defer cancel()

	options := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.UserAgent(ua(task)),
	)

	ctx, cancel = chromedp.NewExecAllocator(ctx, options...)
	defer cancel()

	ctx, cancel = chromedp.NewContext(ctx)
	defer cancel()

	chromedp.ListenTarget(ctx, func(ev interface{}) {
		switch ev := ev.(type) {
		case *network.EventResponseReceived:
			resp := ev.Response
			if len(resp.Headers) != 0 && resp.URL == task.URL {
				fmt.Printf("status: %d, size: %d, url: %s\n", resp.Status, resp.EncodedDataLength, resp.URL)
			}
		}
	})

	start := time.Now()

	var buf []byte
	err := chromedp.Run(ctx, chromedp.Tasks{
		network.Enable(),
		chromedp.Navigate(task.URL),
		chromedp.CaptureScreenshot(&buf),
	})
	if err != nil {
		fmt.Println(err)
		return
	}

	loadTime := time.Since(start)
	log.Printf("Page loaded in: %s", loadTime)

	Report(task)
}
