(function () {
  'use strict';

  var originalFetch = window.fetch.bind(window);
  var oldRevision = 'c68110c495a895be77e349ae85fe36939974d7bc';
  var currentRevision = '65f221f2aaa5a9fe161ed32e03e4dfbb93d4746d';
  var indexSuffix = '/website/public/story_index.json';
  var aliases = [
    [
      'event_story/5101%20-%20%E5%B8%B8%E5%A4%9C%E4%B9%8B%E5%9B%BD%E7%9A%84%E5%8F%9B%E4%B9%B1%E8%80%85%EF%BD%9E%E9%AD%94%E6%B3%95%E5%B0%91%E5%A5%B3%E8%B4%9E%E5%BE%B7%EF%BD%9E',
      'event_story/5101%20-%20%E5%B8%B8%E5%A4%9C%E4%B9%8B%E5%9B%BD%E7%9A%84%E5%8F%9B%E4%B9%B1%E8%80%85%20~%E9%AD%94%E6%B3%95%E5%B0%91%E5%A5%B3%E8%B4%9E%E5%BE%B7~'
    ],
    [
      'event_story/5175%20-%20Dream%20Halloween%20Festa%EF%BD%9E%E9%98%BF%E8%8E%89%E5%A8%9C%E5%89%8D%E8%BE%88%EF%BC%81%E5%81%9A%E4%B8%AA%E5%A5%BD%E5%AD%A9%E5%AD%90%EF%BC%81%EF%BD%9E',
      'event_story/5175%20-%20Dream%20Halloween%20Festa%EF%BD%9E%E9%98%BF%E8%8E%89%E5%A8%9C%E5%89%8D%E8%BE%88%EF%BC%81%E5%81%9A%E8%A6%81%E5%A5%BD%E5%AD%A9%E5%AD%90%E7%9A%84%E8%AF%B4%EF%BC%81%EF%BD%9E'
    ],
    [
      'event_story/5216%20-%20%E6%B5%B7%E5%B2%B8%E8%BE%B9%E7%9A%84%E7%BC%8E%E5%B8%A6',
      'event_story/5216%20-%20%E6%B5%B7%E8%BE%B9%E7%9A%84%E7%BC%8E%E5%B8%A6'
    ]
  ];

  function rewriteRevision(url) {
    return url.replace('/' + oldRevision + '/', '/' + currentRevision + '/');
  }

  function applyAliases(url) {
    var result = url;
    for (var i = 0; i < aliases.length; i++) {
      if (result.indexOf(aliases[i][0]) !== -1) {
        result = result.replace(aliases[i][0], aliases[i][1]);
        break;
      }
    }
    return result;
  }

  function safeIdentity(entry) {
    if (typeof entry.source_identity === 'string' && entry.source_identity) {
      return entry.source_identity;
    }
    if (
      typeof entry.category !== 'string' ||
      typeof entry.folder !== 'string' ||
      typeof entry.file_stem !== 'string'
    ) return '';
    var value = entry.category + '/' + entry.folder + '/' + entry.file_stem;
    if (
      value.charAt(0) === '/' ||
      value.indexOf('\\') !== -1 ||
      value.indexOf('?') !== -1 ||
      value.indexOf('#') !== -1 ||
      value.split('/').some(function (part) { return !part || part === '.' || part === '..'; })
    ) return '';
    return value;
  }

  function normalizeIndex(entries) {
    if (!Array.isArray(entries)) return entries;
    return entries.map(function (entry) {
      if (!entry || typeof entry !== 'object') return entry;
      var identity = safeIdentity(entry);
      return Object.assign({}, entry, {
        game: typeof entry.game === 'string' ? entry.game : 'magireco',
        source_identity: identity || undefined
      });
    });
  }

  function normalizedIndexResponse(response) {
    return response.clone().json().then(function (entries) {
      var headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(normalizeIndex(entries)), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    });
  }

  window.fetch = function (input, init) {
    if (typeof input !== 'string') return originalFetch(input, init);
    var requested = rewriteRevision(input);
    return originalFetch(requested, init).then(function (response) {
      if (response.ok && requested.indexOf('/' + currentRevision + indexSuffix) !== -1) {
        return normalizedIndexResponse(response);
      }
      if (response.status !== 404) return response;
      var retry = applyAliases(requested);
      return retry === requested ? response : originalFetch(retry, init);
    });
  };

  window.__MAGIREADER_CURRENT_REVISION = currentRevision;
})();
