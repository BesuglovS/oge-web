/* Yandex.Metrika — общая функция инициализации */
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}((k=e.createElement(t)),(a=e.getElementsByTagName(t)[0]),(k.async=1),(k.src=r),a.parentNode.insertBefore(k,a))})(window,document,"script","https://mc.yandex.ru/metrika/tag.js?id=107219928","ym");
ym(107219928,"init",{ssr:true,webvisor:true,clickmap:true,ecommerce:"dataLayer",referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});

/* Event tracking helpers */
window.ymEvent = function(name, params) {
  if (typeof ym === 'function') {
    ym(107219928, 'reachGoal', name, params || {});
  }
};

/* Track task started */
window.trackTaskStart = function(taskId) {
  window.ymEvent('task_start', { task_id: taskId });
};

/* Track task completed */
window.trackTaskComplete = function(taskId, score) {
  window.ymEvent('task_complete', { task_id: taskId, score: score });
};

/* Track hint used */
window.trackHint = function(taskId) {
  window.ymEvent('hint_used', { task_id: taskId });
};

/* Track solution viewed */
window.trackSolution = function(taskId) {
  window.ymEvent('solution_viewed', { task_id: taskId });
};
