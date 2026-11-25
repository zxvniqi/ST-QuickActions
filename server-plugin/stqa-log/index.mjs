// 편의성 모음 서버 기록 (optional SillyTavern server plugin)
// Keeps the last lines the server prints (what the Termux window shows) so the extension's
// error window can show them too: GET /api/plugins/stqa-log/lines?since=<ms>.
// Only lines printed after the server started are kept, in memory (nothing is written to disk).

const MAX_LINES = 400;
const MAX_LINE_LENGTH = 2000;
const lines = [];
const restore = [];

// Colour codes the console uses
const plain = text => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function keep(chunk, encoding) {
    try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(Buffer.isEncoding(encoding) ? encoding : 'utf8');
        const now = Date.now();
        for (const line of plain(text).split(/\r?\n/)) {
            if (line.trim()) {
                lines.push({ time: now, text: line.slice(0, MAX_LINE_LENGTH) });
            }
        }
        if (lines.length > MAX_LINES) {
            lines.splice(0, lines.length - MAX_LINES);
        }
    } catch {
        // The console must never fail because of this
    }
}

function watch(stream) {
    const write = stream.write;
    stream.write = function (chunk, encoding, callback) {
        keep(chunk, encoding);
        return write.call(this, chunk, encoding, callback);
    };
    restore.push(() => {
        stream.write = write;
    });
}

export async function init(router) {
    watch(process.stdout);
    watch(process.stderr);
    router.get('/lines', (request, response) => {
        // The server's whole console: with user accounts, admins only
        if (request.user?.profile && request.user.profile.admin === false) {
            return response.sendStatus(403);
        }
        const since = Number(request.query.since) || 0;
        response.json({ lines: lines.filter(line => line.time > since) });
    });
}

export async function exit() {
    restore.forEach(undo => undo());
    restore.length = 0;
}

export const info = {
    id: 'stqa-log',
    name: '편의성 모음 서버 기록',
    description: '서버 콘솔(터묵스 등)에 찍힌 최근 글을 편의성 모음 오류 창에서 보여 줍니다.',
};
