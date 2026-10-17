//! Throwaway Ubuntu spike: serve only the selected, open file over loopback HTTP.
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

struct Selection {
    token: String,
    file: Mutex<File>,
    length: u64,
}

pub struct VideoStream {
    address: SocketAddr,
    selected: Arc<Mutex<Option<Arc<Selection>>>>,
}

impl VideoStream {
    pub fn new() -> io::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?;
        let selected = Arc::new(Mutex::new(None));
        let state = Self { address, selected };
        let selected = state.selected.clone();
        thread::spawn(move || {
            for connection in listener.incoming() {
                let Ok(mut connection) = connection else {
                    break;
                };
                let selected = selected.clone();
                // Concurrent requests let a seek proceed while an earlier request is cancelled.
                thread::spawn(move || {
                    if let Err(error) = serve(&mut connection, address, &selected)
                        && !matches!(
                            error.kind(),
                            io::ErrorKind::BrokenPipe | io::ErrorKind::ConnectionReset
                        )
                    {
                        eprintln!("Video stream: {error}");
                    }
                });
            }
        });
        Ok(state)
    }

    pub fn select(&self, path: &Path) -> io::Result<String> {
        let file = File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(io::Error::other("Choose a nonempty regular MP4 file"));
        }
        // Linux OS entropy; the URL must not be guessable by unrelated websites.
        let mut secret = [0_u8; 32];
        File::open("/dev/urandom")?.read_exact(&mut secret)?;
        let token: String = secret.iter().map(|byte| format!("{byte:02x}")).collect();
        let url = format!("http://{}/{token}/video.mp4", self.address);
        *self
            .selected
            .lock()
            .map_err(|_| io::Error::other("Stream lock poisoned"))? = Some(Arc::new(Selection {
            token,
            file: Mutex::new(file),
            length: metadata.len(),
        }));
        Ok(url)
    }
}

fn byte_range(value: &str, length: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        return (suffix > 0).then_some((length.saturating_sub(suffix), length - 1));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    (start < length && start <= end).then_some((start, end))
}

fn headers(
    stream: &mut TcpStream,
    status: &str,
    length: u64,
    range: Option<&str>,
) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: video/mp4\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n"
    )?;
    if let Some(range) = range {
        write!(stream, "Content-Range: {range}\r\n")?;
    }
    stream.write_all(b"\r\n")
}

fn serve(
    stream: &mut TcpStream,
    address: SocketAddr,
    selected: &Mutex<Option<Arc<Selection>>>,
) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut request = [0_u8; 8192];
    let mut used = 0;
    loop {
        let count = stream.read(&mut request[used..])?;
        if count == 0 {
            return Ok(());
        }
        used += count;
        if request[..used].windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            break;
        }
        if used == request.len() {
            return headers(stream, "431 Request Header Fields Too Large", 0, None);
        }
    }
    let Ok(request) = std::str::from_utf8(&request[..used]) else {
        return headers(stream, "400 Bad Request", 0, None);
    };
    let mut lines = request.split("\r\n");
    let parts: Vec<_> = lines
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .collect();
    if parts.len() != 3 || !matches!(parts[2], "HTTP/1.0" | "HTTP/1.1") {
        return headers(stream, "400 Bad Request", 0, None);
    }
    let mut host = None;
    let mut range = None;
    for line in lines.take_while(|line| !line.is_empty()) {
        let Some((name, value)) = line.split_once(':') else {
            return headers(stream, "400 Bad Request", 0, None);
        };
        if name.eq_ignore_ascii_case("host") {
            if host.is_some() {
                return headers(stream, "403 Forbidden", 0, None);
            }
            host = Some(value.trim())
        }
        if name.eq_ignore_ascii_case("range") {
            range = Some(value.trim())
        }
    }
    if host != Some(address.to_string().as_str()) {
        return headers(stream, "403 Forbidden", 0, None);
    }
    let selection = selected
        .lock()
        .map_err(|_| io::Error::other("Stream lock poisoned"))?
        .clone();
    let Some(selection) =
        selection.filter(|selection| parts[1] == format!("/{}/video.mp4", selection.token))
    else {
        return headers(stream, "404 Not Found", 0, None);
    };
    if !matches!(parts[0], "GET" | "HEAD") {
        return headers(stream, "405 Method Not Allowed", 0, None);
    }
    if parts[0] == "HEAD" {
        return headers(stream, "200 OK", selection.length, None);
    }
    let (start, end) = if let Some(range) = range {
        let Some(range) = byte_range(range, selection.length) else {
            return headers(
                stream,
                "416 Range Not Satisfiable",
                0,
                Some(&format!("bytes */{}", selection.length)),
            );
        };
        range
    } else {
        (0, selection.length - 1)
    };
    let content_range = format!("bytes {start}-{end}/{}", selection.length);
    headers(
        stream,
        if range.is_some() {
            "206 Partial Content"
        } else {
            "200 OK"
        },
        end - start + 1,
        range.map(|_| content_range.as_str()),
    )?;
    let mut offset = start;
    let mut buffer = [0_u8; 64 * 1024];
    while offset <= end {
        let count = (end - offset + 1).min(buffer.len() as u64) as usize;
        {
            let mut file = selection
                .file
                .lock()
                .map_err(|_| io::Error::other("File lock poisoned"))?;
            file.seek(SeekFrom::Start(offset))?;
            file.read_exact(&mut buffer[..count])?;
        }
        stream.write_all(&buffer[..count])?;
        offset += count as u64;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_seek_ranges() {
        assert_eq!(byte_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(byte_range("bytes=7-", 10), Some((7, 9)));
        assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(byte_range("bytes=-20", 10), Some((0, 9)));
        assert_eq!(byte_range("bytes=2-50", 10), Some((2, 9)));
        for invalid in [
            "bytes=10-",
            "bytes=5-2",
            "bytes=-0",
            "bytes=0-1,4-5",
            "invalid",
        ] {
            assert_eq!(byte_range(invalid, 10), None, "{invalid}");
        }
    }

    fn request(server: &VideoStream, route: &str, method: &str, extra: &str) -> Vec<u8> {
        raw_request(
            server,
            &format!(
                "{method} {route} HTTP/1.1\r\nHost: {}\r\n{extra}\r\n",
                server.address
            ),
        )
    }

    fn raw_request(server: &VideoStream, request: &str) -> Vec<u8> {
        let mut socket = TcpStream::connect(server.address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket.write_all(request.as_bytes()).unwrap();
        let mut response = Vec::new();
        socket.read_to_end(&mut response).unwrap();
        response
    }

    #[test]
    fn serves_only_selected_file_and_correct_bytes() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "target/video-stream-test-{}.mp4",
            std::process::id()
        ));
        std::fs::write(&fixture, b"0123456789").unwrap();
        let server = VideoStream::new().unwrap();
        assert_eq!(server.address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(server.address.port(), 0);
        let url = server.select(&fixture).unwrap();
        let route = url
            .strip_prefix(&format!("http://{}", server.address))
            .unwrap();
        let token = route
            .strip_prefix('/')
            .unwrap()
            .strip_suffix("/video.mp4")
            .unwrap();
        assert_eq!(token.len(), 64);
        assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));

        let response = request(&server, route, "GET", "");
        let response = String::from_utf8(response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(
            !response
                .to_ascii_lowercase()
                .contains("access-control-allow-origin")
        );
        assert!(response.ends_with("\r\n\r\n0123456789"));
        for host in [None, Some("evil.example"), Some("127.0.0.1:1")] {
            let host = host
                .map(|host| format!("Host: {host}\r\n"))
                .unwrap_or_default();
            assert!(
                raw_request(&server, &format!("GET {route} HTTP/1.1\r\n{host}\r\n"))
                    .starts_with(b"HTTP/1.1 403")
            );
        }
        // Duplicate Host fields are rejected, even if the last value is correct.
        assert!(
            request(
                &server,
                route,
                "GET",
                &format!("Host: {}\r\n", server.address)
            )
            .starts_with(b"HTTP/1.1 403")
        );
        for (range, expected, content_range) in [
            ("bytes=2-5", "2345", "bytes 2-5/10"),
            ("bytes=7-", "789", "bytes 7-9/10"),
            ("bytes=-3", "789", "bytes 7-9/10"),
        ] {
            let response = request(&server, route, "GET", &format!("Range: {range}\r\n"));
            let response = String::from_utf8(response).unwrap();
            assert!(response.starts_with("HTTP/1.1 206 Partial Content\r\n"));
            assert!(response.contains(&format!("Content-Range: {content_range}\r\n")));
            assert!(response.ends_with(&format!("\r\n\r\n{expected}")));
        }
        let head = String::from_utf8(request(&server, route, "HEAD", "")).unwrap();
        assert!(head.contains("Content-Length: 10\r\n"));
        assert!(head.ends_with("\r\n\r\n"));
        let unsatisfiable =
            String::from_utf8(request(&server, route, "GET", "Range: bytes=10-\r\n")).unwrap();
        assert!(unsatisfiable.starts_with("HTTP/1.1 416 Range Not Satisfiable\r\n"));
        assert!(unsatisfiable.contains("Content-Range: bytes */10\r\n"));
        assert!(unsatisfiable.contains("Content-Length: 0\r\n"));
        assert!(request(&server, "/etc/passwd", "GET", "").starts_with(b"HTTP/1.1 404"));
        assert!(request(&server, route, "POST", "").starts_with(b"HTTP/1.1 405"));
        server.select(&fixture).unwrap();
        assert!(request(&server, route, "GET", "").starts_with(b"HTTP/1.1 404"));
        std::fs::remove_file(fixture).unwrap();
    }

    #[test]
    #[ignore = "Requires a real MP4 path in COURSESHELF_TEST_VIDEO and gst-launch-1.0"]
    fn decodes_real_video_over_http() {
        let server = VideoStream::new().unwrap();
        let path = std::env::var("COURSESHELF_TEST_VIDEO").unwrap();
        let url = server.select(Path::new(&path)).unwrap();
        let status = std::process::Command::new("timeout")
            .args([
                "45s",
                "gst-launch-1.0",
                "-q",
                "uridecodebin",
                &format!("uri={url}"),
                "name=decoded",
                "decoded.",
                "!",
                "queue",
                "!",
                "fakesink",
                "sync=false",
                "decoded.",
                "!",
                "queue",
                "!",
                "fakesink",
                "sync=false",
            ])
            .status()
            .unwrap();
        assert!(status.success(), "GStreamer HTTP decode failed: {status}");
    }
}
