'use strict';
// A real provider must enforce publisher/listener roles on its server, not only mute UI.
// Until credentials and device isolation tests exist, production fails closed.
function getStatus() { return { available: false, message: '真实语音尚未接通' }; }
async function connect() { throw new Error('真实语音尚未接通，暂不能准备开局'); }
async function disconnect() { return; }
module.exports = { getStatus, connect, disconnect };
