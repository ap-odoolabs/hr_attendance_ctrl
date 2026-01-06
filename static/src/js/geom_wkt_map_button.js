(function(){
  'use strict';
  var TAG = '[hr_attendance_ctrl]';
  function onReady(cb){ if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', cb); else cb(); }

  function findGeomField(){
    var el =
      document.querySelector('textarea[name="geom_wkt"]') ||
      document.querySelector('.o_field_widget[name="geom_wkt"] textarea') ||
      document.querySelector('.o_field_text[name="geom_wkt"] textarea') ||
      document.querySelector('[name="geom_wkt"] textarea') ||
      document.querySelector('[data-name="geom_wkt"] textarea') ||
      document.querySelector('[data-name="geom_wkt"]') ||
      document.querySelector('[name="geom_wkt"]');
    return el || null;
  }

  function setFieldValue(field, wkt){
    try{
      if(!field) return;
      if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT'){
        field.value = wkt;
      } else if (field.getAttribute && field.getAttribute('contenteditable') === 'true'){
        field.textContent = wkt;
      } else {
        var ta = field.querySelector && field.querySelector('textarea');
        if (ta) ta.value = wkt;
        else if (field.querySelector) {
          var inp = field.querySelector('input');
          if (inp) inp.value = wkt;
        }
      }
      var target = field.tagName ? field :
                   (field.querySelector && (field.querySelector('textarea') || field.querySelector('input'))) || field;
      if (target && target.dispatchEvent){
        target.dispatchEvent(new Event('input', { bubbles:true }));
        target.dispatchEvent(new Event('change', { bubbles:true }));
      }
      console.debug(TAG, 'WKT injected to field.');
    }catch(e){ console.warn(TAG, 'Failed to set WKT:', e); }
  }

  function placeButton(field){
    if (!field) return;
    var host = (field.closest && field.closest('.o_field_widget, .o_input, .o_td_label, .o_form_label')) || field.parentElement || document.body;
    if (host.dataset && host.dataset.wktBtnAttached) return;
    if (host.dataset) host.dataset.wktBtnAttached = '1';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-custom-blue';
    btn.style.marginTop = '6px';
    btn.textContent = 'Draw on Map';

    btn.addEventListener('click', function(){
      var wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.inset = '0';
      wrapper.style.background = 'rgba(0,0,0,0.4)';
      wrapper.style.zIndex = '9999';
      wrapper.innerHTML = ''
        + '<div style="position:absolute;top:5%;left:5%;width:90%;height:90%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.2)">'
        + '  <div style="height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid #e5e7eb">'
        + '    <strong>Polygon Editor</strong><button id="closeMapDlg" class="btn btn-link">Close</button>'
        + '  </div>'
        + '  <iframe src="/attendance_ctrl/map_editor" style="width:100%;height:calc(100% - 44px);border:0;"></iframe>'
        + '</div>';
      document.body.appendChild(wrapper);
      var iframe = wrapper.querySelector('iframe');
      if (iframe){
        var sendInit = function(){
          try{
            var wkt = (field && (field.value || field.textContent || '')).trim();
            if (wkt && /^POLYGON\s*\(\(/i.test(wkt)){
              iframe.contentWindow.postMessage({type:'odoo-geom-wkt-init', wkt: wkt}, '*');
            }
          }catch(e){ console.error('Failed to send init WKT', e); }
        };
        // send once on load (and also retry shortly after to be safe)
        iframe.addEventListener('load', function(){
          sendInit();
          setTimeout(sendInit, 300);
          setTimeout(sendInit, 1000);
        });
      }


      function cleanup(){
        window.removeEventListener('message', onMsg);
        if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      }
      wrapper.querySelector('#closeMapDlg').addEventListener('click', cleanup);

      function onMsg(ev){
        var data = ev && ev.data;
        if (!data || data.type !== 'odoo-geom-wkt' || !data.wkt) return;
        setFieldValue(field, data.wkt);
        cleanup();
      }
      window.addEventListener('message', onMsg);
    });

    if (field.parentNode && field.nextSibling){
      field.parentNode.insertBefore(btn, field.nextSibling);
    } else if (host && host.appendChild){
      host.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
    console.debug(TAG, 'Draw on Map button injected.');
  }

  function init(){
    var field = findGeomField();
    if (field) placeButton(field);
  }

  onReady(function(){
    init();
    var mo = new MutationObserver(function(){ init(); });
    mo.observe(document.body, { childList:true, subtree:true });
    setInterval(init, 1500);
  });
})();