// eslint-disable-next-line
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["validateOptions", "getFileOptions"] }] */
/* eslint no-console: ["error", { allow: ["log", "error"] }] */

const url = require('url');
const request = require('request-promise');
const path = require('path');
const revalidator = require('revalidator');
const mm = require('micromatch');
const chalk = require('chalk');

const Qiniu = require('./qiniu');
const { combineFiles, mapLimit } = require('./utils');
const Reporter = require('./reporter');

const LOG_FILENAME = '__qiniu__webpack__plugin__files.json';
const CONFIG_FILENAME = '.qiniu_webpack';
const PLUGIN_NAME = 'QiniuWebpackPlugin';

/**
 * options: {
 *    accessKey: string, @required
 *    secretKey: string, @required
 *    bucket: string, @required
 *    bucketDomain: string, @required
 *    matchFiles: [],
 *    uploadPath: string,
 *    batch: number
 * }
 */

class QiniuPlugin {
  constructor(options = {}) {
    const defaultOptions = {
      uploadPath: '/', // default uploadPath
      batch: 10,
      deltaUpdate: true,
    };
    const fileOptions = this.getFileOptions();
    this.options = Object.assign(defaultOptions, options, fileOptions);

    this.validateOptions(this.options);

    const { uploadPath } = this.options;

    if (uploadPath[0] === '/') {
      this.options.uploadPath = uploadPath.slice(1, uploadPath.length);
    }

    const {
      accessKey,
      secretKey,
      bucket,
      bucketDomain,
      options: otherOptions,
    } = this.options;
    this.publicPath = url.resolve(bucketDomain, uploadPath); // domain + uploadPath
    this.qiniu = new Qiniu({
      accessKey,
      secretKey,
      bucket,
      domain: bucketDomain,
      options: otherOptions,
    });
  }

  validateOptions(options) {
    const validate = revalidator.validate(options, {
      properties: {
        accessKey: {
          type: 'string',
          required: true,
        },
        secretKey: {
          type: 'string',
          required: true,
        },
        bucket: {
          type: 'string',
          required: true,
          minLength: 4,
          maxLength: 63,
        },
        bucketDomain: {
          type: 'string',
          required: true,
          message: 'is not a valid url',
          conform(v) {
            // eslint-disable-next-line
            const urlReg = /[-a-zA-Z0-9@:%_\+.~#?&//=]{1,256}\.[a-z]{1,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi;
            if (urlReg.test(v)) {
              return true;
            }
            return false;
          },
        },
        uploadPath: {
          type: 'string',
        },
        matchFiles: {
          type: 'array',
        },
        batch: {
          type: 'number',
        },
        deltaUpdate: {
          type: 'boolean',
        },
      },
    });

    if (!validate.valid) {
      const { errors } = validate;
      console.log(chalk.bold.red('[QiniuWebpackPlugin] options validate failure:'));
      for (let i = 0, len = errors.length; i < len; i += 1) {
        const error = errors[i];
        console.log('\n    > ', error.property, error.message);
      }
      console.log('\n');
      process.exit();
    }
  }

  apply(compiler) {
    // eslint-disable-next-line
    const beforeRunCallback = (compiler, callback) => {
      // TODO: 检查 output.filename 是否有 hash 输出
      // eslint-disable-next-line
      compiler.options.output.publicPath = this.publicPath;
      callback();
    };

    const afterEmitCallback = (compilation, callback) => {
      this.qiniu.deleteList({
        prefix: this.options.options.replacePrefix,
      })
      .then(() => {
        this.qiniu.copyList()
          .then(async(res) => {
            if (res.code !== 200) {
              throw res;
            }
            const fileNames = Object.keys(compilation.assets);
            console.log('\n');
            console.log(chalk.bold.green('==== Qiniu Webpack Plugin ==== \n'));
            const reporter = new Reporter('\n');

            // 处理文件过滤
            const releaseFiles = this.matchFiles(fileNames);

            reporter.text = '📦   正在获取历史数据';

            // 获取文件日志
            const {
              prev: prevFiles = [],
              current: currentFiles = [],
            } = await this.getLogFile();
            reporter.log = '📦   获取历史数据';

            // 合并去重，提取最终要上传和删除的文件
            const { uploadFiles, deleteFiles } = combineFiles(prevFiles, currentFiles, releaseFiles);

            reporter.log = `🍔   将上传 ${uploadFiles.length} 个文件`;

            const uploadFileTasks = uploadFiles.map((filename, index) => {
              const file = compilation.assets[filename];

              return async () => {
                const key = path.posix.join(this.options.uploadPath, filename);

                reporter.text = `🚀  正在上传第 ${index + 1} 个文件: ${key}`;

                const result = await this.qiniu.putFile(key, file.existsAt);

                return result;
              };
            });

            try {
              await mapLimit(uploadFileTasks, this.options.batch,
                (task, next) => {
                  (async () => {
                    try {
                      const res = await task();
                      next(null, res);
                    } catch (err) {
                      next(err);
                    }
                  })();
                });
            } catch (e) {
              console.error(chalk.bold.red('\n\n上传失败:'));
              callback(e);
            }

            reporter.log = '❤️   上传完毕';

            // 当有文件要上传才去删除之前版本的文件，且写入日志
            if (uploadFiles.length > 0 && !this.options.deltaUpdate) {
              if (deleteFiles.length > 0) {
                reporter.log = `👋🏼   将删除 ${deleteFiles.length} 个文件`;
                reporter.text = '🤓   正在批量删除...';
                await this.deleteOldFiles(deleteFiles);
                reporter.log = '💙   删除完毕';
              }

              reporter.text = '📝   正在写入日志...';
              await this.writeLogFile(currentFiles, releaseFiles);
              reporter.log = '📝   日志记录完毕';
            }

            reporter.succeed('🎉 \n');
            console.log(chalk.bold.green('==== Qiniu Webpack Plugin ==== \n'));

            callback();
          })
          .catch((e) => {
            console.error(chalk.bold.red('\n\n文件移动失败:'));
            console.log(JSON.stringify(e));
            callback(e);
          });
      })
      .catch((e) => {
        console.error(chalk.bold.red('\n\n文件删除失败:'));
        console.log(JSON.stringify(e));
        callback(e);
      });
    };

    if (compiler.hooks) {
      compiler.hooks.beforeRun.tapAsync(PLUGIN_NAME, beforeRunCallback);
      compiler.hooks.afterEmit.tapAsync(PLUGIN_NAME, afterEmitCallback);
    } else {
      compiler.plugin('before-run', beforeRunCallback);
      compiler.plugin('after-emit', afterEmitCallback);
    }
  }

  matchFiles(fileNames) {
    const { matchFiles = [] } = this.options;

    matchFiles.unshift('*'); // all files

    return mm(fileNames, matchFiles, { matchBase: true });
  }

  getFileOptions() {
    try {
      // eslint-disable-next-line
      return require(path.resolve(CONFIG_FILENAME));
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        throw e;
      }
      return null;
    }
  }

  /**
   * 删除旧的文件
   * @param {Array<string>} deleteFiles 待删除文件列表
   */
  async deleteOldFiles(deleteFiles) {
    if (deleteFiles.length > 0) {
      const keys = deleteFiles
        .map(filename => path.posix.join(this.options.uploadPath, filename));
      await this.qiniu.batchDelete(keys);
    }
  }

  /**
   * 记录文件列表
   * @param {Array<string>} currentFiles 当前线上的文件列表
   * @param {Array<string>} releaseFiles 等待发布的文件列表
   */
  async writeLogFile(currentFiles, releaseFiles) {
    const json = JSON.stringify({
      prev: currentFiles,
      current: releaseFiles,
      uploadTime: new Date(),
    });
    const key = path.posix.join(this.options.uploadPath, LOG_FILENAME);
    const result = await this.qiniu.put(key, json);

    return result;
  }

  /**
   * 获取文件列表
   */
  async getLogFile() {
    const remotePath = path.posix.join(this.options.uploadPath, LOG_FILENAME);
    let logDownloadUrl = this.qiniu.getPublicDownloadUrl(remotePath);

    const randomParams = `?r=${+new Date()}`;

    // 域名没有通信协议
    if (logDownloadUrl.indexOf('//') === 0) {
      logDownloadUrl = `http:${logDownloadUrl}`;
    }

    return request({
      uri: logDownloadUrl + randomParams,
      json: true,
    })
      .catch(() => ({ prev: [], current: [], uploadTime: '' }));
  }
}

module.exports = QiniuPlugin;
