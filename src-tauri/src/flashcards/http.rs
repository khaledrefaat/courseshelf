use super::{Message, Reply, Usage};
use serde_json::{Value, json};
use std::time::Duration;

pub const ENDPOINT: &str = "https://api.z.ai/api/paas/v4/chat/completions";
pub const MODEL: &str = "glm-5.3-flash";

pub fn messages_valid(messages: &[Message]) -> bool {
    messages.len() == 2
        && messages[0].role == "system"
        && messages[1].role == "user"
        && messages
            .iter()
            .all(|message| !message.content.trim().is_empty())
        && serde_json::to_string(messages).is_ok_and(|json| json.encode_utf16().count() <= 65_000)
}

fn count(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= 9_007_199_254_740_991)
}

fn decode(bytes: &[u8], key: &str) -> Result<Reply, String> {
    // Never retain provider headers, reasoning or full response envelopes. Even
    // an unexpected echoed credential must not enter a checkpoint or UI error.
    let text = std::str::from_utf8(bytes).map_err(|_| "Provider returned invalid UTF-8.")?;
    let text = text.replace(key, "[redacted]");
    let value: Value = serde_json::from_str(&text)
        .map_err(|_| "Provider returned invalid JSON; usage is unknown.")?;
    let choice = value["choices"]
        .as_array()
        .filter(|choices| choices.len() == 1)
        .and_then(|choices| choices.first())
        .ok_or("Provider returned no unique response; usage is unknown.")?;
    let content = choice["message"]["content"]
        .as_str()
        .ok_or("Provider returned no text; usage is unknown.")?;
    let usage = (|| {
        Some(Usage {
            prompt_tokens: count(&value["usage"]["prompt_tokens"])?,
            completion_tokens: count(&value["usage"]["completion_tokens"])?,
            total_tokens: count(&value["usage"]["total_tokens"])?,
        })
    })();
    Ok(Reply {
        // Redact again after JSON unescaping, so quoted/backslashed keys cannot
        // slip through as escaped bytes in the provider's JSON text.
        content: content.replace(key, "[redacted]"),
        usage,
        model: value["model"]
            .as_str()
            .unwrap_or("unknown")
            .replace(key, "[redacted]")
            .chars()
            .take(100)
            .collect(),
        finish_reason: choice["finish_reason"]
            .as_str()
            .unwrap_or("unknown")
            .replace(key, "[redacted]")
            .chars()
            .take(50)
            .collect(),
    })
}

pub async fn request(key: String, messages: Vec<Message>) -> Result<Reply, String> {
    let client = client(true)?;
    send(&client, ENDPOINT, &key, &messages).await
}

fn client(https_only: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(https_only)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "Could not initialize secure flashcard connection.".into())
}

// Private transport seam for loopback fixtures only. Production always supplies
// the constant HTTPS endpoint above, never any renderer-provided destination.
async fn send(
    client: &reqwest::Client,
    endpoint: &str,
    key: &str,
    messages: &[Message],
) -> Result<Reply, String> {
    let body = serde_json::to_vec(&json!({
        "model": MODEL, "messages": messages, "stream": false, "temperature": 1,
        "top_p": 0.95, "max_tokens": 8192, "thinking": { "type": "enabled" },
        "reasoning_effort": "low", "response_format": { "type": "json_object" }
    }))
    .map_err(|_| "Could not encode flashcard request.")?;
    let mut response = client
        .post(endpoint)
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(
            |_| "Flashcard request failed or timed out; usage is unknown. It was not retried.",
        )?;
    if !response.status().is_success() {
        return Err(format!(
            "Flashcard provider returned HTTP {}; usage may be unknown. No automatic retry.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > super::storage::MAX_REPLY)
    {
        return Err("Provider response is too large; usage is unknown.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Provider response was interrupted; usage is unknown.")?
    {
        if bytes.len() + chunk.len() > super::storage::MAX_REPLY as usize {
            return Err("Provider response is too large; usage is unknown.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    decode(&bytes, key)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_credentials_reasoning_and_envelopes_and_preserves_reported_usage() {
        let body = json!({"model": MODEL, "choices":[{"finish_reason":"stop","message":{"content":"{\"notes\":\"demo-private-key\"}","reasoning_content":"private reasoning"}}],
            "usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16},"secret":"demo-private-key"});
        let reply = decode(&serde_json::to_vec(&body).unwrap(), "demo-private-key").unwrap();
        let saved = serde_json::to_string(&reply).unwrap();
        assert!(!saved.contains("demo-private-key"));
        assert!(!saved.contains("reasoning"));
        assert!(saved.contains("[redacted]"));
        assert_eq!(reply.usage.unwrap().total_tokens, 16);
        assert!(decode(b"not JSON", "key").unwrap_err().contains("unknown"));
        let escaped_key = "quoted\"and\\slashed-key";
        let body = json!({"model": MODEL, "choices":[{"finish_reason":"stop","message":{"content": escaped_key}}]});
        let saved = decode(&serde_json::to_vec(&body).unwrap(), escaped_key).unwrap();
        assert_eq!(saved.content, "[redacted]");
    }
    #[test]
    fn rejects_role_injection_and_oversized_messages() {
        assert!(!messages_valid(&[]));
        let messages = vec![
            Message {
                role: "system".into(),
                content: "rules".into(),
            },
            Message {
                role: "user".into(),
                content: "transcript".into(),
            },
        ];
        assert!(messages_valid(&messages));
        assert!(!messages_valid(&[Message {
            role: "tool".into(),
            content: "x".into()
        }]));
        assert!(!messages_valid(&[
            messages[0].clone(),
            Message {
                role: "user".into(),
                content: "x".repeat(65_000)
            }
        ]));
    }

    #[test]
    fn real_http_fixture_checks_request_schema_and_never_follows_redirects_or_retries_errors() {
        use std::{thread, time::Duration};
        use tiny_http::{Header, Response, Server, StatusCode};
        for status in [200, 302, 500] {
            let server = Server::http("127.0.0.1:0").unwrap();
            let address = format!("http://{}/completion", server.server_addr());
            let worker = thread::spawn(move || {
                let mut request = server
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap()
                    .unwrap();
                assert_eq!(request.method().as_str(), "POST");
                assert_eq!(request.url(), "/completion");
                assert_eq!(
                    request
                        .headers()
                        .iter()
                        .find(|header| header.field.equiv("Authorization"))
                        .unwrap()
                        .value
                        .as_str(),
                    "Bearer demo-test-key"
                );
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                let body: Value = serde_json::from_str(&body).unwrap();
                assert_eq!(body["model"], MODEL);
                assert_eq!(body["max_tokens"], 8192);
                assert_eq!(body["reasoning_effort"], "low");
                assert_eq!(body["messages"].as_array().unwrap().len(), 2);
                assert!(body.get("tools").is_none());
                let response = if status == 200 {
                    json!({"model": MODEL,"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}).to_string()
                } else {
                    "provider body echo demo-test-key".into()
                };
                request
                    .respond(
                        Response::from_string(response)
                            .with_status_code(StatusCode(status))
                            .with_header(
                                Header::from_bytes("Location", "/must-not-follow").unwrap(),
                            ),
                    )
                    .unwrap();
                // Any automatic retry/redirect would arrive here.
                assert!(
                    server
                        .recv_timeout(Duration::from_millis(100))
                        .unwrap()
                        .is_none()
                );
            });
            let messages = vec![
                Message {
                    role: "system".into(),
                    content: "rules".into(),
                },
                Message {
                    role: "user".into(),
                    content: "cues".into(),
                },
            ];
            let result = tauri::async_runtime::block_on(send(
                &client(false).unwrap(),
                &address,
                "demo-test-key",
                &messages,
            ));
            if status == 200 {
                assert_eq!(result.unwrap().content, "{}");
            } else {
                let error = result.unwrap_err();
                assert!(error.contains(&status.to_string()));
                assert!(!error.contains("demo-test-key"));
            }
            worker.join().unwrap();
        }
    }

    #[test]
    fn response_size_is_bounded_before_json_decoding() {
        use std::thread;
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = format!("http://{}/completion", server.server_addr());
        let worker = thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .unwrap();
            let _ = request.respond(tiny_http::Response::from_string(
                "x".repeat(super::super::storage::MAX_REPLY as usize + 1),
            ));
        });
        let messages = vec![
            Message {
                role: "system".into(),
                content: "rules".into(),
            },
            Message {
                role: "user".into(),
                content: "cues".into(),
            },
        ];
        let error = tauri::async_runtime::block_on(send(
            &client(false).unwrap(),
            &address,
            "demo-test-key",
            &messages,
        ))
        .unwrap_err();
        assert!(error.contains("too large"));
        worker.join().unwrap();
    }
}
