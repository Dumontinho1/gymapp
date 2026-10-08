/* Runs before first paint (loaded synchronously from <head>): applies the saved
   theme and accent color so the page never flashes the defaults, and installs a
   safety net so the splash screen can never stay on top of the app forever. */
window.__gymappLoadStart = Date.now();
try{
  var t = localStorage.getItem('gymapp:theme');
  var theme = t ? JSON.parse(t) : 'dark';
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');

  var ac = JSON.parse(localStorage.getItem('gymapp:accentColors') || 'null');
  var hex = /^#[0-9a-fA-F]{6}$/;
  if(Array.isArray(ac) && hex.test(ac[0]) && hex.test(ac[1])){
    var rs = document.documentElement.style;
    rs.setProperty('--accent', ac[0]);
    rs.setProperty('--accent-2', ac[1]);
    rs.setProperty('--accent-grad', 'linear-gradient(135deg,' + ac[0] + ',' + ac[1] + ')');
  }
}catch(e){}

// If app.js throws before it hides the splash, remove it anyway after a few seconds.
setTimeout(function(){
  var s = document.getElementById('splash');
  if(s){ s.classList.add('hide'); setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s); }, 500); }
}, 6000);
