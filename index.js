/* eslint no-console:0 */
var fs = require('fs');
var path = require('path');
var del = require('del');
var run = require('electron-installer-run');
var glob = require('glob');
var async = require('async');
var chalk = require('chalk');
var figures = require('figures');
var debug = require('debug')('electron-installer-codesign');

function checkAppExists(opts, fn) {
  debug('checking appPath `%s` exists...', opts.appPath);
  fs.exists(opts.appPath, function(exists) {
    if (!exists) {
      debug('appPath `%s` does not exist!', opts.appPath);
      return fn(new Error(opts.appPath + ' does not exist.'));
    }
    debug('appPath exists');
    fn();
  });
}

// Clean up ".cstemp" files from previous attempts
function cleanup(opts, fn) {
  debug('running cleanup');
  del([opts.appPath + '/*.cstemp']).then(function() {
    fn();
  });
}

function runCodesign(src, opts, fn) {
  var args = [
    '-s',
    opts.identity,
    '-vvv',
    '--deep',
    '--force',
    src
  ];

  run('codesign', args, function(err) {
    if (err) {
      fn(new Error('codesign failed ' + path.basename(src)
        + '. See output above for more details.'));
      return;
    }
    fn(null, src);
  });
}

function codesign(pattern, opts, fn) {
  glob.glob(pattern, function(err, files) {
    if (err) {
      return fn(err);
    }

    if (files.length === 0) {
      return fn(new Error('No files found for '
        + opts.appPath + '/' + pattern));
    }
    async.parallel(files.map(function(src) {
      return function(cb) {
        debug('signing %s...', path.basename(src));
        runCodesign(src, opts, cb);
      };
    }), function(_err, _files) {
      if (_err) {
        return fn(_err);
      }
      debug('%d files signed successfully!', _files.length);
      fn(null, _files);
    });
  });
}

function verify(src, fn) {
  debug('verifying signature on `%s`...', src);

  var args = [
    '--verify',
    '-vvv',
    src
  ];
  run('codesign', args, function(err) {
    if (err) {
      return fn(err);
    }
    fn(null, src);
  });
}

/**
 * @param {String} commonName
 * @param {Function} fn - Callback.
 */
function isIdentityAvailable(commonName, fn) {
  run('certtool', ['y'], function(err, output) {
    if (err) {
      debug('Failed to list certificates.');
      fn(null, false);
      return;
    }
    if (output.indexOf(commonName) === -1) {
      debug('Signing identity `%s` not detected.',
        commonName);
      fn(null, false);
      return;
    }

    debug('The signing identity `%s` is available!', commonName);

    fn(null, true);
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

module.exports.isIdentityAvailable = isIdentityAvailable;
module.exports.codesign = codesign;
module.exports.verify = verify;

module.exports.printWarning = function() {
  console.error(chalk.yellow.bold(figures.warning),
    ' User confusion ahead!');

  console.error(chalk.gray(
    '  The default preferences for OSX Gatekeeper will not',
    'allow users to run unsigned applications.'));

  console.error(chalk.gray(
    '  However, we\'re going to continue building',
    'the app and an installer because you\'re most likely'));

  console.error(chalk.gray(
    '  a developer trying to test',
    'the app\'s installation process.'));

  console.error(chalk.gray(
    '  For more information on OSX Gatekeeper and how to change your',
    'system preferences to run unsigned applications,'));
  console.error(chalk.gray('  please see',
    'https://support.apple.com/en-us/HT202491'));
};
