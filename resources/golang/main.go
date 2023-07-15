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

type TaskType string

const (
	TaskTypeApi  TaskType = "API"
	TaskTypeHtml TaskType = "HTML"
)

type HttpMethod string

const (
	HttpMethodGet  HttpMethod = "GET"
	HttpMethodPost HttpMethod = "POST"
	HttpMethodPut  HttpMethod = "PUT"
)

type ComputeType string

const (
	ComputeTypeLambda  ComputeType = "Lambda"
	ComputeTypeEC2     ComputeType = "EC2"
	ComputeTypeFargate ComputeType = "Fargate"
	ComputeTypeBatch   ComputeType = "Batch"
)

type HttpStatusCode int

type Execution struct {
	// define the fields of Execution here
}

type Task struct {
	ShouldEnd                       bool
	Report                          bool
	TaskName                        string
	TaskId                          string
	TaskType                        TaskType
	TaskClient                      *int
	URL                             string
	Method                          HttpMethod
	Compute                         ComputeType
	KeyName                         *string
	InstanceType                    *string
	QPS                             *int
	N                               *int
	C                               int
	TaskDelaySeconds                *int
	RunInstanceBatch                *int
	Regions                         []string
	Region                          string
	CurrentStateMachineExecutedLeft *int
	TimeoutMs                       time.Duration
	SuccessCode                     HttpStatusCode
	StartTime                       string
	CreatedAt                       string
	EndTime                         string
}

func main() {
	envJson := os.Getenv("TASK")
	if envJson == "" {
		lambda.Start(HandleSNSEvent)
	} else {
		var task Task
		err := json.Unmarshal([]byte(envJson), &task)
		if err != nil {
			log.Fatalf("Error unmarshaling task from environment variable: %v", err)
		}
		ProcessTask(task)
	}
}

func HandleSNSEvent(ctx context.Context, snsEvent events.SNSEvent) error {
	for _, record := range snsEvent.Records {
		var task Task
		err := json.Unmarshal([]byte(record.SNS.Message), &task)
		if err != nil {
			log.Printf("Error unmarshaling SNS message: %v", err)
			continue
		}
		fmt.Println(record.SNS.MessageID)
		ProcessTask(task)
	}
	return nil
}

func ProcessTask(task Task) {
	// print task as json string
	taskJson, _ := json.Marshal(task)
	fmt.Println(string(taskJson))

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
		if task.QPS != nil {
			for {
				var wg sync.WaitGroup
				for i := 0; i < *task.QPS; i++ {
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
			times := *task.N / task.C
			for i := 0; i < times; i++ {
				FetchAndMeasure(task)
			}
		}
	} else {
		fmt.Println("URL does not exist in JSON or is not a string")
	}

}

func FetchAndMeasure(task Task) {

	if task.TaskType == TaskTypeApi {
		FetchAndMeasureApi(task)
	}

	if task.TaskType == TaskTypeHtml {
		FetchAndMeasureHtml(task)
	}

}

func FetchAndMeasureApi(task Task) {
	timeout := task.TimeoutMs / 1000
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	start := time.Now()

	req, _ := http.NewRequest(http.MethodGet, task.URL, nil)
	req = req.WithContext(ctx)
	resp, err := http.DefaultClient.Do(req)

	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	duration := time.Since(start)

	fmt.Printf("The network latency for the url %s is %s %d\n", task.URL, duration, resp.StatusCode)

}

func FetchAndMeasureHtml(task Task) {
	timeout := task.TimeoutMs / 1000
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
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
		log.Fatal(err)
	}

	loadTime := time.Since(start)
	log.Printf("Page loaded in: %s", loadTime)
}
