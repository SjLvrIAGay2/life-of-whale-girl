# Windows' native TLS transport for authenticated requests to the private site.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Net.Http
$client=[Net.Http.HttpClient]::new()
$client.Timeout=[TimeSpan]::FromSeconds(28)
$base=[uri]$env:WHALE_SITE_ORIGIN
if ($base.Scheme -ne 'https' -or !$base.Host.EndsWith('.chatgpt.site')) {exit 1}
$endpoint=[uri]::new($base,'/api/v1/life/qq-bridge')
try {
 while($null -ne ($line=[Console]::ReadLine())){
  $id=$null;$code=502;$body=$null;$request=$null;$response=$null
  try {
   $payload=$line|ConvertFrom-Json;$id=[int]$payload.id
   $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post,$endpoint)
   [void]$request.Headers.TryAddWithoutValidation('OAI-Sites-Authorization',('Bearer '+$env:WHALE_SITE_ACCESS))
   [void]$request.Headers.TryAddWithoutValidation('x-whale-bridge',$env:WHALE_BRIDGE_KEY)
   $request.Content=[Net.Http.StringContent]::new(($payload.body|ConvertTo-Json -Depth 16 -Compress),[Text.UTF8Encoding]::new($false),'application/json')
   $response=$client.SendAsync($request).GetAwaiter().GetResult()
   $code=[int]$response.StatusCode
   if($response.IsSuccessStatusCode){$body=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json}
  } catch { $code=503 }
  finally {if($request){$request.Dispose()};if($response){$response.Dispose()}}
  [Console]::WriteLine((@{id=$id;status=$code;body=$body}|ConvertTo-Json -Depth 18 -Compress))
 }
} finally {$client.Dispose()}
