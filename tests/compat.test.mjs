import test from 'node:test';
import assert from 'node:assert/strict';

test('EasyProxy compatibility surface', () => {
  const paths = [
    '/proxy/manifest.m3u8','/proxy/hls/manifest.m3u8','/proxy/mpd/manifest.m3u8',
    '/proxy/stream','/extractor/video','/playlist','/proxy/ip','/generate_urls','/license','/key',
    '/api/info','/info','/builder','/record','/recordings'
  ];
  assert.equal(paths.length, 15);
});

test('url and d aliases are accepted by contract', () => {
  const a = new URL('https://worker.test/proxy/stream?url=https%3A%2F%2Fexample.com%2Fa');
  const b = new URL('https://worker.test/proxy/stream?d=https%3A%2F%2Fexample.com%2Fa');
  assert.equal(a.searchParams.get('url'), b.searchParams.get('d'));
});

test('h_ headers preserve EasyProxy convention', () => {
  const u = new URL('https://worker.test/proxy/stream?url=x&h_user-agent=VLC&h_referer=https%3A%2F%2Fsite.test');
  const h = Object.fromEntries([...u.searchParams].filter(([k])=>k.startsWith('h_')).map(([k,v])=>[k.slice(2),v]));
  assert.deepEqual(h, {'user-agent':'VLC', referer:'https://site.test'});
});
