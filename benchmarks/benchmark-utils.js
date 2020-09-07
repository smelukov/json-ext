const fs = require('fs');
const chalk = require('chalk');
const { Readable } = require('stream');
const ANSI_REGEXP = /([\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;

class StringStream extends Readable {
    constructor(str) {
        let pushed = null;
        super({
            read() {
                if (!pushed) {
                    pushed = setTimeout(() => {
                        this.push(str);
                        this.push(null);
                    }, 1);
                }
            }
        });
    }
}

function stripAnsi(str) {
    return str.replace(ANSI_REGEXP, '');
}

function prettySize(size, signed, pad) {
    const unit = ['', 'kB', 'MB', 'GB'];

    while (Math.abs(size) > 1000) {
        size /= 1000;
        unit.shift();
    }

    return (
        (signed && size > 0 ? '+' : '') +
        size.toFixed(unit.length > 2 ? 0 : 2) +
        unit[0]
    ).padStart(pad || 0);
}

function memDelta(_base, cur) {
    const current = cur || process.memoryUsage();
    const delta = {};
    const base = { ..._base };

    for (const [k, v] of Object.entries(current)) {
        base[k] = base[k] || 0;
        delta[k] = v - base[k];
    }

    return {
        base,
        current,
        delta,
        toString() {
            const res = [];

            for (const [k, v] of Object.entries(delta)) {
                const rel = _base && k in _base;
                res.push(`${k} ${(rel && v > 0 ? chalk.yellow : chalk.green)(prettySize(v, rel, 9))}`);
            }

            return res.join(' | ') || 'No changes';
        }
    };
}

async function timeout(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

function traceMem(resolutionMs, sample = false) {
    const base = process.memoryUsage();
    const max = { ...base };
    const startTime = Date.now();
    const samples = [];
    const takeSample = () => {
        const mem = process.memoryUsage();

        if (sample) {
            samples.push({
                time: Date.now() - startTime,
                mem
            });
        }

        for (let key in base) {
            if (max[key] < mem[key]) {
                max[key] = mem[key];
            }
        }
    };
    const timer = setInterval(
        takeSample,
        isFinite(resolutionMs) && parseInt(resolutionMs) > 0 ? parseInt(resolutionMs) : 16
    );

    return {
        base,
        max,
        get current() {
            return memDelta(base);
        },
        series(abs) {
            const keys = Object.keys(base);
            const series = {};

            for (const key of keys) {
                series[key] = {
                    name: key,
                    data: new Array(samples.length)
                };
            }

            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i];

                for (const key of keys) {
                    series[key].data[i] = abs
                        ? sample.mem[key] || 0
                        : sample.mem[key] ? sample.mem[key] - base[key] : 0;
                }
            }

            return {
                time: samples.map(s => s.time),
                series: Object.values(series)
            };
        },
        stop() {
            clearInterval(timer);
            takeSample();
            return memDelta(base);
        }
    };
}

function captureStdout(callback) {
    const oldWrite = process.stdout.write;
    const cancelCapture = () => process.stdout.write = oldWrite;
    let buffer = [];

    process.stdout.write = (chunk, encondig, fd) => {
        oldWrite.call(process.stdout, chunk, encondig, fd);
        buffer.push(chunk);
    };

    process.on('exit', () => {
        cancelCapture();
        callback(buffer.join(''));
        buffer = null;
    });

    return cancelCapture;
}

function replaceInReadme(start, end, replace) {
    const content = fs.readFileSync('README.md', 'utf8');
    const mstart = content.match(start);

    if (!mstart) {
        throw new Error('No start offset found');
    }

    const startOffset = mstart.index + mstart[0].length;
    const endRegExp = new RegExp(end, (end.flags || '').replace('g', '') + 'g');
    endRegExp.lastIndex = startOffset;
    const mend = endRegExp.exec(content);

    if (!mend) {
        throw new Error('No end offset found');
    }

    const endOffset = mend.index;

    fs.writeFileSync('README.md',
        content.slice(0, startOffset) +
        (typeof replace === 'function' ? replace(content.slice(startOffset, endOffset)) : replace) +
        content.slice(endOffset), 'utf8');
}

function outputToReadme(start, end, fmt = output => output) {
    captureStdout(content => replaceInReadme(start, end, fmt(stripAnsi(content))));
}

module.exports = {
    StringStream,
    prettySize,
    memDelta,
    traceMem,
    timeout,
    captureStdout,
    replaceInReadme,
    outputToReadme
};