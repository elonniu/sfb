use std::env;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use reqwest::Error;
use serde_json::Value;
use tokio::time::sleep;

async fn get_env_json(env_var: &str) -> serde_json::Result<Value> {
    let json_str = env::var(env_var).unwrap_or_else(|_| String::from("{}"));
    println!("{}", json_str);
    let v: Value = serde_json::from_str(&json_str)?;
    Ok(v)
}

async fn fetch_and_measure(url: &str) -> Result<(), Error> {
    let start = Instant::now();

    let resp = reqwest::get(url).await?;
    let _ = resp.text().await?;

    let duration = start.elapsed();

    println!("Time elapsed in fetching {} is: {:?}", url, duration);

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let env_value = get_env_json("TASK").await.unwrap_or_else(|err| {
        println!("Error while parsing json from env: {:?}", err);
        Value::Null
    });

    if let Some(Value::String(creation_time_str)) = env_value.get("createdAt") {
        let creation_time = DateTime::parse_from_rfc3339(creation_time_str).unwrap().with_timezone(&Utc);
        let now = Utc::now();
        let duration = now.signed_duration_since(creation_time);
        println!("Task was created {} seconds ago", duration.num_seconds());
    }


    if let Some(Value::String(start_time_str)) = env_value.get("startTime") {
        let start_time = DateTime::parse_from_rfc3339(start_time_str).unwrap().with_timezone(&Utc);
        let mut now = Utc::now();
        while now < start_time {
            sleep(Duration::from_millis(100)).await; // Sleep for 0.1 seconds
            now = Utc::now();
        }
    }

    let end_time = if let Some(Value::String(end_time_str)) = env_value.get("endTime") {
        Some(DateTime::parse_from_rfc3339(end_time_str).unwrap().with_timezone(&Utc))
    } else {
        None
    };

    if let Some(Value::String(url)) = env_value.get("url") {
        let url = url.clone();
        if let Some(Value::Number(qps)) = env_value.get("qps") {
            let qps = qps.as_u64().unwrap_or(1);
            loop {
                let tasks = (0..qps).map(|_| {
                    let url = url.clone();
                    tokio::spawn(async move {
                        fetch_and_measure(&url).await.unwrap();
                    })
                });
                futures::future::join_all(tasks).await;
                sleep(Duration::from_secs(1)).await;
                if let Some(end_time) = end_time {
                    let now = Utc::now();
                    if now > end_time {
                        break;
                    }
                }
            }
        } else if let (Some(Value::Number(n)), Some(Value::Number(c))) = (env_value.get("n"), env_value.get("c")) {
            let n = n.as_u64().unwrap_or(1);
            let c = c.as_u64().unwrap_or(1);
            let times = n / c;
            for _ in 0..times {
                fetch_and_measure(&url).await?;
            }
        } else {
            fetch_and_measure(&url).await?;
        }
    } else {
        println!("URL does not exist in JSON or is not a string");
    }

    Ok(())
}
