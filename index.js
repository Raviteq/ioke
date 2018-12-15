var gm = require("gm");
var sharp = require("sharp");
var express = require("express");
var path = require("path");
var Promise = require("bluebird");
var urlJoin = require("url-join");
var kashmir = require("kashmir");

var middleware = function(rootPath, backend, translator, headers, cacheOpts) {
  var cache;
  if (cacheOpts) {
    cache = new kashmir.Cache(cacheOpts);
  }

  return function(req, res, next) {
    //
    // Get transform object from query string.
    //
    var transform = Object.keys(req.query).length ? req.query : void 0;

    //
    // Fetch backend.
    //
    try {
      translator =
        translator ||
        function(rootPath, req) {
          return validUrl.isUri(rootPath)
            ? urlJoin(rootPath, req.path)
            : path.join(rootPath, req.path);
        };

      Promise.resolve(translator(rootPath, req))
        .then(function(srcPath) {
          var opts = typeof opts == "string" ? { url: opts } : srcPath;

          (cache ? cache.get(opts.url) : Promise.resolve())
            .then(function(cached) {
              if (cached) {
                return {
                  stream: cached.stream,
                  size: cached.size,
                  mimeType: cached.meta.mimeType
                };
              } else {
                return backend.fetch(srcPath, cache).then(function(src) {
                  if (cache) {
                    cache.set(opts.url, src.stream, src.size, {
                      mimeType: src.mimeType
                    });
                  }
                  return src;
                });
              }
            })
            .then(function(src) {
              src.stream.on("error", function(err) {
                if (err.code == "ENOENT") {
                  next();
                } else {
                  console.error(err);
                  res.status(500).end(err);
                }
              });

              //
              // Transform if needed.
              //
              if (transform) {
                if (headers) {
                  res.set(
                    Object.assign(
                      {
                        "Content-Type": src.mimeType
                      },
                      headers
                    )
                  );
                }
                transformImage(transform, src, res);
              } else {
                src.stream
                  .on("response", function(res) {
                    if (headers) {
                      for (header in headers) {
                        var lowerCaseheader = header.toLowerCase();
                        if (typeof headers[header] === "undefined") {
                          delete res.headers[lowerCaseheader];
                        } else {
                          res.headers[lowerCaseheader] = headers[header];
                        }
                      }
                    }
                  })
                  .pipe(res);
              }
            });
        })
        .catch(function(err) {
          console.error(err);
          res.status(404).end();
        });
    } catch (err) {
      console.error(err);
      res.status(404).end();
      return;
    }
  };
};

function transformImage(transform, src, dst) {
  if (isCrop(transform)) {
    if (transform.r) {
      var img = gm(src.stream).size({ bufferStream: true }, function(
        err,
        size
      ) {
        if (err) {
          res.status(500).send(err);
          return;
        }
        var w = size.width;
        var h = size.height;
        img
          .crop(
            (transform.w * w) / 100,
            (transform.h * h) / 100,
            (transform.x * w) / 100,
            (transform.y * h) / 100
          )
          .stream()
          .pipe(dst);
      });
    } else {
      gm(src.stream)
        .crop(transform.w, transform.h, transform.x, transform.y)
        .stream()
        .pipe(dst);
    }
  } else if (isScale(transform)) {
    scale(transform, src, dst);
  }
}

function scale(transform, src, dst) {
  if (transform.r) {
    gm(src.stream)
      .resize(transform.w, transform.h, "%")
      .stream()
      .pipe(dst);
  } else {
    const transformer = sharp();
    transformer.resize(
      transform.w && parseInt(transform.w),
      transform.h && parseInt(transform.h),
      {
        fit: transform.w && transform.h ? sharp.fit.fill : sharp.fit.cover,
        withoutEnlargement: true
      }
    );
    src.stream.pipe(transformer).pipe(dst);
  }
}

module.exports = function(rootPath, backend) {
  var app = express.Router();

  app.get("*", middleware(rootPath, backend));

  function transformEtag(transform) {
    if (transform) {
      var props = ["w", "h", "x", "y"];
      return props.reduce(function(prev, cur) {
        if (transform[cur]) {
          return prev + transform[cur];
        }
        return prev;
      }, "");
    } else {
      return "";
    }
  }

  return app;
};

function isCrop(transform) {
  return (
    transform && (transform.x || transform.y) && (transform.w || transform.h)
  );
}

function isScale(transform) {
  return (transform && transform.w) || transform.h;
}

//
// Simple Backend
//
var mime = require("mime-types");
var fs = require("fs");
Promise.promisifyAll(fs);

var etag = require("etag");
var validUrl = require("valid-url");

var Backend = function() {
  this.fetch = function(opts) {
    var mimeType = mime.lookup(opts.url);
    if (validUrl.isUri(opts.url)) {
      return getHttpStream(opts);
    } else {
      return getFileStream(opts);
    }
  };
};

var http = require("http");
var https = require("https");
var url = require("url");
function getHttpStream(opts) {
  var parsedUrl = url.parse(opts.url);
  opts = Object.assign(
    {
      method: "GET",
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      port: parsedUrl.port
        ? parsedUrl.port
        : parsedUrl.protocol === "https:"
        ? 443
        : 80
    },
    opts
  );

  var protocol = opts.protocol == "https:" ? https : http;

  return new Promise(function(resolve, reject) {
    var req = protocol.request(opts, function(res) {
      resolve({
        stream: res,
        size: parseInt(res.headers["content-length"]),
        mimeType: res.headers["content-type"] || mime.lookup(opts.url)
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function getFileStream(opts) {
  return new Promise(function(resolve, reject) {
    fs.stat(opts.url, function(err, stats) {
      if (err) {
        reject(err);
      } else {
        resolve({
          mimeType: mime.lookup(opts.url),
          stream: fs.createReadStream(opts.url),
          size: stats.size
        });
      }
    });
  });
}

module.exports.Backend = Backend;
module.exports.middleware = middleware;
