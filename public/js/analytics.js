/* 百度统计接入:
 * 1. 到 tongji.baidu.com 注册并添加站点 https://www.gesppass.com
 * 2. 获取代码里 hm.js? 后面那串 ID,填到下面引号中
 * 3. 推送部署即可;ID 为空时本文件不做任何事
 */
var BAIDU_TONGJI_ID = 'd833ecdc06408fb59cfaeeee0fc37c58';
(function(){
  if(!BAIDU_TONGJI_ID) return;
  window._hmt = window._hmt || [];
  var hm = document.createElement('script');
  hm.src = 'https://hm.baidu.com/hm.js?' + BAIDU_TONGJI_ID;
  var s = document.getElementsByTagName('script')[0];
  s.parentNode.insertBefore(hm, s);
})();
