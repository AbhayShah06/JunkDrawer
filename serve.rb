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
WIN = (RbConfig::CONFIG['host_os'] =~ /mswin|mingw|cygwin/) ? true : false
BIN_OS = File.join(BIN, WIN ? 'win' : 'mac')  # bins live in a per-OS subfolder
def have?(cmd)
  names = WIN ? ["#{cmd}.exe", cmd] : [cmd]
  [BIN_OS, BIN].each { |d| names.each { |n| return true if File.exist?(File.join(d, n)) } }
  ENV['PATH'].to_s.split(File::PATH_SEPARATOR).any? { |p| names.any? { |n| File.executable?(File.join(p, n)) } }
end

class IsoFileHandler < WEBrick::HTTPServlet::FileHandler
  def service(req, res)
    # Set the cross-origin-isolation + CSP headers BEFORE super so they're present on
    # every response path (304s, redirects), not just plain 200s.
    res['Cross-Origin-Opener-Policy'] = 'same-origin'
    res['Cross-Origin-Embedder-Policy'] = 'credentialless'
    res['Cache-Control'] = 'no-store'
    # No remote code: script-src has no http(s) origin, so only our own bundled,
    # inline, wasm and blob scripts run. Everything is vendored locally.
    res['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; " \
      "worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " \
      "img-src 'self' data: blob: https:; font-src 'self' data:; " \
      "connect-src 'self' https: data: blob:; media-src 'self' blob: data:"
    super
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
    # DNS-rebinding defense: the Host must be a loopback name (a missing Host is hostile).
    host = (req['host'] || '').split(':').first
    # CSRF defense: this state-changing POST always carries an Origin from our renderer
    # (a JSON fetch isn't CORS-simple). Require it present AND ours — fail closed on absence.
    origin = req['origin']
    unless ['127.0.0.1', 'localhost'].include?(host) && ALLOWED.include?(origin)
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
    # MP3 needs ffmpeg to transcode; without it yt-dlp would save the raw webm/m4a
    # stream, not an MP3. Fail clearly rather than mislabel.
    if mode == 'audio' && !have?('ffmpeg')
      res.status = 501; res['Content-Type'] = 'application/json'
      res.body = { error: 'ffmpeg-missing' }.to_json; next
    end

    Dir.mktmpdir('jd-') do |tmp|
      ffmpeg_ok = have?('ffmpeg')
      # Hardening: --no-config ignores any yt-dlp.conf; --restrict-filenames strips path
      # separators/unicode from the remote-controlled media title (no traversal); the
      # trailing '--' stops option parsing so the URL can never be read as a flag.
      yt = ['yt-dlp', '--no-config', '--restrict-filenames', '--no-playlist', '-o', '%(title)s.%(ext)s']
      cmd = case mode
            when 'spotify' then ['spotdl', 'download', '--', url]
            when 'audio'
              yt + ['-x', '--audio-format', 'mp3', '--', url]
            else
              ffmpeg_ok ? yt + ['-f', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4', '--', url]
                        : yt + ['-f', 'best[ext=mp4]/best', '--', url]
            end
      jd_env = { 'PATH' => "#{BIN_OS}#{File::PATH_SEPARATOR}#{BIN}#{File::PATH_SEPARATOR}#{ENV['PATH']}" }  # so yt-dlp finds bundled ffmpeg
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
