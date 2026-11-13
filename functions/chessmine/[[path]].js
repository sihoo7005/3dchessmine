export async function onRequest({request}) {
  const url = new URL(request.url);
  const target = 'https://jsaur.duckdns.org' + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('X-Chessmine-Pages', '1');
  if (request.method === 'GET' && url.pathname.startsWith('/chessmine/api/cross/') && !headers.has('Origin')) {
    headers.set('Origin', 'https://3dchessmine.pages.dev');
  }
  const response = await fetch(target, {method: request.method, headers, body: request.body, redirect: 'manual'});
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  return result;
}
