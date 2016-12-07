
var gm = require('gm');
var express = require('express');
var path = require('path');
var etag = require('etag');

module.exports = function (rootPath, backend) {

  var app = express.Router();

  app.get('*', function (req, res, next) {

    //
    // Get transform object from query string.
    //
    var transform = Object.keys(req.query).length ? req.query : void 0;

    //
    // Fetch backend.
    //
    var srcPath = path.join(rootPath, req.path);

    var src = backend.fetch(srcPath);

    //
    // Set headers
    res.set({
      'Content-Type': src.mimeType,
      'ETag': src.ETag + transformEtag(transform)
    });

    //
    // Transform if needed.
    //
    if (transform) {
      if (isCrop(transform)) {
        if(transform.r){
          var img = gm(src.stream).size({bufferStream: true}, function(err, size){
            if(err){
              res.status(500).send(err);
              return;
            }
            var w = size.width;
            var h = size.height;
            img.crop(
              (transform.w * w) / 100,
              (transform.h * h) / 100,
              (transform.x * w) / 100,
              (transform.y * h) / 100).stream().pipe(res);
          });
        }else{
          gm(src.stream).crop(transform.w, transform.h, transform.x, transform.y).stream().pipe(res);
        }

      } else if (isScale(transform)) {
        gm(src.stream).resize(transform.w, transform.h, transform.r ? '%' : '').stream().pipe(res);
      }
    } else {
      src.stream.pipe(res);
    }
  });

  function transformEtag(transform) {
    if(transform){
      var props = ['w','h','x','y'];
      return props.reduce(function(prev, cur){
        if(transform[cur]){
          return prev + transform[cur];
        }
        return prev;
      }, '');
    }else{
      return '';
    }
  }

  function isCrop(transform){
    return transform &&
      (transform.x || transform.y) &&
      (transform.w || transform.h)
  }

  function isScale(transform){
    return (transform &&
      transform.w ||
      transform.h);
  }

  return app;
}

var mime = require('mime-types');
var fs = require('fs');
var backend = {
  fetch: function(filePath){
    var weakEtag = etag(fs.statSync(filePath));
    return {
      mimeType: mime.lookup(filePath),
      stream: fs.createReadStream(filePath),
      ETag: weakEtag
    }
  }
}

module.exports.backend = backend;
