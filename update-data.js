/* 双击「更新数据.bat」走这里：
   进程内 require 生成器（本机 node 进程不能 spawn 子进程），
   按命令行直接跑 工具/生成数据包.js 的方式伪造 argv，行为一致。 */
process.argv = [process.argv[0], require('path').join(__dirname, '工具', '生成数据包.js')];
require('./工具/生成数据包.js');
console.log('');
console.log('==============================================');
console.log('  ✅ 数据更新完成！');
console.log('  下一步：回到「看板.html」页面，按 F5 刷新，');
console.log('  就能看到最新数据。');
console.log('==============================================');
