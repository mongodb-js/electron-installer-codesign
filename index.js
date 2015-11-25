var fs = require('fs');
var path = require('path');
var del = require('del');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var glob = require('glob');
var async = require('async');
var format = require('util').format;
var debug = require('debug')('electron-installer-codesign');

function checkAppExists(opts, fn) {
  debug('checking appPath exists...', opts.appPath);
  fs.exists(opts.appPath, function(exists) {
    if (!exists) return fn(new Error(opts.appPath + ' does not exist.'));
    fn();
  });
}

// Clean up ".cstemp" files from previous attempts
function cleanup(opts, fn) {
  del(opts.appPath + '/*.cstemp', fn);
}

function runCodesign(src, opts, fn) {
  var args = [
    '-s', '"' + opts.identity + '"', '-vvv', '--deep', '--force',
    '"' + src + '"'
  ];
  var child = spawn('codesign', args);
  debug('running `codesign %s`', args.join(' '));
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('exit', function(code) {
    if (code === 0) return fn(null, src);
    console.error('codesign failed on `%s`', path.basename(src));
    return fn(new Error('codesign failed ' + path.basename(src) + '. See output above for more details.'));
  });
}

function codesign(pattern, opts, fn) {
  glob.glob(pattern, function(err, files) {
    if (err) return fn(err);

    if (files.length === 0) {
      return fn(new Error('No files found for ' + opts.appPath + '/' + pattern));
    }
    async.parallel(files.map(function(src) {
      return function(cb) {
        debug('signing %s...', path.basename(src));
        runCodesign(src, opts, cb);
      };
    }), function(err, files) {
      if (err) return fn(err);
      debug('%d files signed successfully!', files.length);
      fn(null, files);
    });
  });
}

function verify(src, cb) {
  debug('verifying signature on `%s`...', src);
  var cmd = format('codesign --verify -vvv "%s"', src);
  exec(cmd, function(err, stdout, stderr) {
    if (err) {
      console.error('codesign --verify failed on `%s`', src, err);
      console.error('  cmd: %s', cmd);
      console.error('  stdout: %s', stdout);
      console.error('  stderr: %s', stderr);
      return cb(err);
    }
    cb(null, src);
  });
}

module.exports = function(opts, done) {
  async.series([
    checkAppExists.bind(null, opts),
    cleanup.bind(null, opts),
    codesign.bind(null, opts.appPath + '/Contents/Frameworks/*', opts),
    codesign.bind(null, opts.appPath + '/Contents/MacOS/*', opts),
    codesign.bind(null, opts.appPath, opts),
    verify.bind(null, opts.appPath)
  ], done);
};
