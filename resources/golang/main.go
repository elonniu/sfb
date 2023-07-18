package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/chromedp/chromedp"
)

type Task struct {
	ShouldEnd   bool          `json:"shouldEnd"`
	Report      bool          `json:"report"`
	Name        string        `json:"name"`
	Version     string        `json:"version"`
	TaskId      string        `json:"taskId"`
	Type        string        `json:"type"` // Assuming TaskType is a string in TypeScript
	Client      *int          `json:"client"`
	URL         string        `json:"url"`
	Method      string        `json:"method"`  // Assuming Method is a string in TypeScript
	Compute     string        `json:"compute"` // Assuming Compute is a string in TypeScript
	Qps         *int          `json:"qps"`
	N           *int          `json:"n"`
	C           int           `json:"c"`
	Delay       *int          `json:"delay"`
	Regions     []string      `json:"regions"`
	Region      string        `json:"region"`
	NPerClient  *int          `json:"nPerClient"`
	Timeout     time.Duration `json:"timeout"`
	SuccessCode int           `json:"successCode"` // Assuming HttpStatusCode is an int in TypeScript
	StartTime   string        `json:"startTime"`
	CreatedAt   string        `json:"createdAt"`
	EndTime     string        `json:"endTime"`
	States      interface{}   `json:"states"` // Assuming States is an arbitrary JSON structure
	Status      string        `json:"status"` // Assuming Status is a string in TypeScript
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
	duration := time.Since(creationTime)
	fmt.Printf("Task was created %d seconds ago\n", int64(duration.Seconds()))

	startTime, err := time.Parse(time.RFC3339, task.StartTime)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	for time.Now().Before(startTime) {
		time.Sleep(100 * time.Millisecond)
	}

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

func FetchAndMeasureApi(task Task) {
	ctx, cancel := context.WithTimeout(context.Background(), task.Timeout)
	defer cancel()

	start := time.Now()

	req, _ := http.NewRequest(http.MethodGet, task.URL, nil)
	req = req.WithContext(ctx)
	resp, err := http.DefaultClient.Do(req)

	if err != nil {
		fmt.Println(err)
		return
	}
	defer resp.Body.Close()

	duration := time.Since(start)

	fmt.Printf("%s %d %s", task.URL, resp.StatusCode, duration)
}

func FetchAndMeasureHtml(task Task) {
	ctx, cancel := context.WithTimeout(context.Background(), task.Timeout)
	defer cancel()

	ctx, cancel = chromedp.NewContext(ctx)
	defer cancel()

	start := time.Now()

	var buf []byte
	err := chromedp.Run(ctx, chromedp.Tasks{
		chromedp.Navigate(task.URL),
		chromedp.CaptureScreenshot(&buf),
	})
	if err != nil {
		fmt.Println(err)
		return
	}

	loadTime := time.Since(start)
	log.Printf("Page loaded in: %s", loadTime)
}
