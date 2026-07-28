(function () {
  'use strict';
  var originalFetch = window.fetch.bind(window);
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

  window.fetch = function (input, init) {
    return originalFetch(input, init).then(function (response) {
      if (response.status !== 404 || typeof input !== 'string') return response;
      var retry = input;
      for (var i = 0; i < aliases.length; i++) {
        if (retry.indexOf(aliases[i][0]) !== -1) {
          retry = retry.replace(aliases[i][0], aliases[i][1]);
          break;
        }
      }
      return retry === input ? response : originalFetch(retry, init);
    });
  };
})();
