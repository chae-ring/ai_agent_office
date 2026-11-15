$url = 'http://127.0.0.1:3000/'
$deadline = (Get-Date).AddSeconds(60)

while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Start-Process $url
            exit 0
        }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

exit 1
