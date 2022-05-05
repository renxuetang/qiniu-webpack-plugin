const ora = require('ora');
const chalk = require('chalk');

const { log } = console;

class Reporter {
  constructor(msg) {
    this.spinner = ora(msg).start();
  }

  set text(msg) {
    this.spinner.text = msg;
  }

  set log(msg) {
    this.spinner.stop();
    log(chalk.white(msg));
    this.spinner.start();
  }

  succeed(msg) {
    this.spinner.succeed(msg || null);
  }

  fail(msg) {
    this.spinner.fail(msg || null);
  }

  stop() {
    this.spinner.stop();
  }
}

module.exports = Reporter;
