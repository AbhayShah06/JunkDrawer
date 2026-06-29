# Local server for Junk Drawer (fallback for Macs without python3).
# Serves the static app with cross-origin-isolation headers, and exposes the
# same /api/check and /api/download endpoints that shell out to yt-dlp / spotdl.
require 'webrick'
require 'json'
require 'open3'
require 'tmpdir'
require 'cgi'

root = File.expand_path(File.dirname(__FILE__))
port = (ENV['PORT'] || '8777').to_i
ALLOWED = ["http://127.0.0.1:#{port}", "http://localhost:#{port}"]

BIN = File.join(root, 'resources', 'bin')  # bundled yt-dlp / ffmpeg, if present
def have?(cmd)
  File.exist?(File.join(BIN, cmd)) ||
    ENV['PATH'].to_s.split(File::PATH_SEPARATOR).any? { |p| File.executable?(File.join(p, cmd)) }
end

class IsoFileHandler < WEBrick::HTTPServlet::FileHandler
  def service(req, res)
    super
    res['Cross-Origin-Opener-Policy'] = 'same-origin'
    res['Cross-Origin-Embedder-Policy'] = 'credentialless'
    res['Cache-Control'] = 'no-store'
    # No remote code: script-src has no http(s) origin, so only our own bundled,
    # inline, wasm and blob scripts run. Everything is vendored locally.
    res['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: data:; " \
      "worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " \
      "img-src 'self' data: blob: https:; font-src 'self' data:; " \
      "connect-src 'self' https: data: blob:; media-src 'self' blob: data:"
  end
end

server = WEBrick::HTTPServer.new(
  Port: port, BindAddress: '127.0.0.1',
  Logger: WEBrick::Log.new(File::NULL), AccessLog: []
)

server.mount_proc('/api/check') do |_req, res|
  res['Content-Type'] = 'application/json'
  res.body = { ytdlp: have?('yt-dlp'), spotdl: have?('spotdl'), ffmpeg: have?('ffmpeg') }.to_json
end

server.mount_proc('/api/download') do |req, res|
  begin
    # DNS-rebinding defense: the Host we were reached through must be loopback.
    host = (req['host'] || '').split(':').first
    # CSRF defense: a cross-site page's request carries its own Origin; only ours pass.
    origin = req['origin']
    if (host && !['127.0.0.1', 'localhost'].include?(host)) || (origin && !ALLOWED.include?(origin))
      res.status = 403; res['Content-Type'] = 'application/json'
      res.body = { error: 'blocked cross-site request' }.to_json; next
    end
    body = JSON.parse(req.body || '{}')
    url  = (body['url'] || '').strip
    mode = body['mode'] || 'video'
    raise 'Please paste a full https:// link.' unless url =~ %r{\Ahttps?://}

    tool = mode == 'spotify' ? 'spotdl' : 'yt-dlp'
    unless have?(tool)
      res.status = 501; res['Content-Type'] = 'application/json'
      res.body = { error: "#{tool == 'spotdl' ? 'spotdl' : 'ytdlp'}-missing" }.to_json; next
    end

    Dir.mktmpdir('jd-') do |tmp|
      ffmpeg_ok = have?('ffmpeg')
      cmd = case mode
            when 'spotify' then ['spotdl', 'download', url]
            when 'audio'
              ffmpeg_ok ? ['yt-dlp', '-x', '--audio-format', 'mp3', '--no-playlist', '-o', '%(title)s.%(ext)s', url]
                        : ['yt-dlp', '-f', 'bestaudio', '--no-playlist', '-o', '%(title)s.%(ext)s', url]
            else
              ffmpeg_ok ? ['yt-dlp', '-f', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4', '--no-playlist', '-o', '%(title)s.%(ext)s', url]
                        : ['yt-dlp', '-f', 'best[ext=mp4]/best', '--no-playlist', '-o', '%(title)s.%(ext)s', url]
            end
      jd_env = { 'PATH' => "#{BIN}#{File::PATH_SEPARATOR}#{ENV['PATH']}" }  # so yt-dlp finds bundled ffmpeg
      _out, err, st = Open3.capture3(jd_env, *cmd, chdir: tmp)
      unless st.success?
        res.status = 500; res['Content-Type'] = 'application/json'
        res.body = { error: 'tool-failed', detail: (err || '')[-2500..-1] || err }.to_json; next
      end

      files = Dir.children(tmp).map { |f| File.join(tmp, f) }.select { |f| File.file?(f) }
      raise 'The tool finished but produced no file.' if files.empty?

      if files.length > 1
        # e.g. a Spotify playlist -> bundle with the macOS `zip` CLI
        zpath = File.join(tmp, '_bundle.zip')
        Open3.capture3('zip', '-j', '-q', zpath, *files)
        out = File.file?(zpath) ? zpath : files.max_by { |f| File.size(f) }
        name = File.file?(zpath) ? 'spotify-downloads.zip' : File.basename(out)
      else
        out = files.first
        name = File.basename(out)
      end

      res.status = 200
      res['Content-Type'] = 'application/octet-stream'
      res['Content-Disposition'] = %(attachment; filename="#{name.gsub('"', '')}")
      res['X-Filename'] = CGI.escape(name)
      res['Access-Control-Expose-Headers'] = 'X-Filename'
      res.body = File.binread(out)
    end
  rescue => e
    res.status = 400; res['Content-Type'] = 'application/json'
    res.body = { error: e.message }.to_json
  end
end

server.mount('/', IsoFileHandler, root)

puts "\n  🗄️  Junk Drawer is running"
puts "  →  http://127.0.0.1:#{port}/index.html"
puts "  link-downloads: yt-dlp #{have?('yt-dlp') ? '✓' : '✗'}  spotdl #{have?('spotdl') ? '✓' : '✗'}  ffmpeg #{have?('ffmpeg') ? '✓' : '✗'}"
puts "\n  Leave this window open. Close it (or press Ctrl+C) to stop.\n\n"

trap('INT') { server.shutdown }
server.start
