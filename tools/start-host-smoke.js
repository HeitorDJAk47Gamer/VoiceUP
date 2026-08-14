const path = require('path');
const { startSignalingServer } = require('../signaling-server');

const port = Number(process.env.PORT || 3182);
let running;
startSignalingServer(port, {
  pluginDirectories: [path.join(__dirname, '..', 'plugins')],
  musicDirectory: path.join(__dirname, '..', 'music')
}).then((value) => {
  running = value;
  console.log(`host-smoke-ready ${port}`);
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
function close() {
  running?.io.close();
  running?.server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
