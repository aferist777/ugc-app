/* ════════════════════════════════════════════════════════════════════════
   SCENARIOS V2 — Pipeline Lab (ported into the main app's "Scen V2" tab).

   Staged scenario generation: BASE → VOICE → FINALIZATION. The lab used to
   live as a standalone page (public/pipeline-lab.html); it is now embedded in
   #l1-scenarii-v2 / #s2-root with a scoped dark theme and a New / Saved toggle.

   Backend (file-based prompt library in prompts/<theme>/):
     GET  /api/scenarios-v2/config        types + verticals + emotions
     POST /api/scenarios-v2/lab/steps     resolved combined prompts per step
     POST /api/scenarios-v2/lab/run       run one step (single user message)
     POST /api/scenarios-v2/lab/save-step persist edited step prompt (placeholder-safe)
     POST /api/scenarios-v2/lab/hooks     4 finalization hooks
     GET/POST per-vertical hooks / comparisons, taboo levels, options, scene ranges
     CRUD  /api/scenarios-v2[/...]        saved scenarios store

   window.ScenariosV2.activate() is called by tabs.js showComboPanel('scen2').
   All DOM lookups are scoped to #s2-root so the lab's generic ids (title,
   model, emotion, …) never collide with the rest of the app.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const API = '/api/scenarios-v2';
  const state = { theme:'marketing', type:'ugc_ad', types:[], steps:[], roles:[], narratorGender:'any', voEnabled:false, voGender:'any', versions:{}, hooks:[], chosenHook:'', raw:{}, tpl:{}, soh:'', stx:'', soh2:'', stx2:'', prevMark:'', sep:'' };
  const ROLE_PRESETS = { vsl:['Host','Expert','Skeptic','Guest','Cohost'], dialogue:['Interviewer','Guest'] };
  const GENDERS = [['any','any'],['male','♂ male'],['female','♀ female']];
  const HIDDEN_TYPES = ['ugc_review'];
  const PAUSED_TYPES = ['vsl', 'dialogue'];   // only ugc_ad + voiceover are live; vsl + interview are in development
  const INGREDIENT_EXAMPLES = 'Common kitchen / bathroom items you can build a fake recipe from: banana, cucumber, honey, baking soda, lemon, garlic, olive oil, eggs, salt, sugar, black coffee, vinegar, apple cider vinegar, ginger, cinnamon, milk, yogurt, oats, coconut oil, aloe vera, toothpaste, mayonnaise, mustard, onion, potato, tomato, watermelon, avocado, peanut butter, chili pepper, mint, green tea, baking powder, butter, ice cubes, cabbage, carrot, cocoa.';

  let _built = false;

  // ── ROOT-scoped DOM helpers (ids are unique only inside the lab subtree) ────
  function ROOT(){ return document.getElementById('s2-root'); }
  const $  = id  => { const r = ROOT(); return r ? r.querySelector('#' + id) : null; };
  const $$ = sel => { const r = ROOT(); return r ? r.querySelectorAll(sel) : []; };
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ════════════════════════════════════════════════════════════════════════
  // SCOPED LIGHT THEME (classic silver/navy — matches the Character tab)
  // ════════════════════════════════════════════════════════════════════════
  function _injectCSS(){
    if (document.getElementById('pl-styles')) return;
    const s = document.createElement('style');
    s.id = 'pl-styles';
    s.textContent = `
#l1-scenarii-v2{ --bg:#c0c0c0; --panel:#d4d0c8; --panel2:#c8c4bc; --line:#808080; --ink:#000000; --mut:#444444; --acc:#000080; --acc2:#000080; --ok:#1a7a1a; --warn:#9a6b00; --err:#a00000; --pill:#ffffff;
  background:var(--bg); color:var(--ink); font:12px/1.5 "Pixelated MS Sans Serif",Tahoma,Arial,sans-serif; }
#l1-scenarii-v2 *{box-sizing:border-box}
#l1-scenarii-v2 a{color:var(--acc)}
#s2-root{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
#pl-new{flex:1;min-height:0;overflow:auto}
#l1-scenarii-v2 .wrap{max-width:1280px;margin:0 auto;padding:14px 20px 80px}
#l1-scenarii-v2 h1{font-size:16px;margin:0 0 2px;font-weight:700;color:var(--acc)}
#l1-scenarii-v2 .sub{color:var(--mut);font-size:12px;margin:0 0 14px}
#l1-scenarii-v2 .card{background:var(--panel);border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;padding:14px 16px;margin-bottom:14px}
#l1-scenarii-v2 .card h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--acc);margin:0 0 10px;font-weight:700}
#l1-scenarii-v2 select,#l1-scenarii-v2 input,#l1-scenarii-v2 textarea,#l1-scenarii-v2 button{font-family:inherit;font-size:12px;color:var(--ink)}
#l1-scenarii-v2 label.fld{display:flex;flex-direction:column;align-items:stretch;gap:4px;font-size:11px;color:var(--mut)}
#l1-scenarii-v2 label.fld>select,#l1-scenarii-v2 label.fld>input,#l1-scenarii-v2 label.fld>textarea{width:100%;max-width:100%}
#l1-scenarii-v2 .row{display:flex;flex-wrap:wrap;gap:10px}
#l1-scenarii-v2 .row>label.fld{flex:1;min-width:150px}
#l1-scenarii-v2 button{cursor:pointer;border:2px solid;border-color:#fff #808080 #808080 #fff;background:#d4d0c8;border-radius:2px;padding:5px 12px;transition:.12s;color:#000}
#l1-scenarii-v2 button:hover{background:#e0ddd6}
#l1-scenarii-v2 button:active{border-color:#808080 #fff #fff #808080}
#l1-scenarii-v2 button.primary{background:#000080;border:2px solid;border-color:#5a5af0 #00004a #00004a #5a5af0;color:#fff;font-weight:700}
#l1-scenarii-v2 button.primary:hover{background:#0000aa}
#l1-scenarii-v2 button:disabled{opacity:.5;cursor:not-allowed}
/* New / Saved toggle bar */
#l1-scenarii-v2 .pl-tabs{display:flex;align-items:center;gap:8px;padding:6px 16px;background:var(--panel2);border-bottom:2px solid #808080;flex-shrink:0;flex-wrap:wrap}
#l1-scenarii-v2 .pl-tab{padding:5px 14px;border-radius:2px;font-weight:600;font-size:12px}
#l1-scenarii-v2 .pl-tab.on{background:#000080;border-color:#5a5af0 #00004a #00004a #5a5af0;color:#fff}
#l1-scenarii-v2 .pl-tabs-sp{flex:1}
#l1-scenarii-v2 .pl-inl{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--mut)}
#l1-scenarii-v2 .pl-inl>span{white-space:nowrap}
/* step cards */
#l1-scenarii-v2 .step{background:var(--panel);border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;margin-bottom:14px;overflow:hidden}
#l1-scenarii-v2 .step.s1{border-left:3px solid #000080}
#l1-scenarii-v2 .step.s2{border-left:3px solid #000080}
#l1-scenarii-v2 .step.s3{border-left:3px solid var(--ok)}
#l1-scenarii-v2 .step.s4{border-left:3px solid var(--warn)}
#l1-scenarii-v2 .step .hd{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--panel2);border-bottom:1px solid #808080;cursor:pointer;user-select:none}
#l1-scenarii-v2 .step.collapsed .hd{border-bottom:none}
#l1-scenarii-v2 .step .hd .chev{color:var(--mut);font-size:11px;transition:transform .15s;width:12px}
#l1-scenarii-v2 .step:not(.collapsed) .hd .chev{transform:rotate(90deg)}
#l1-scenarii-v2 .step .hd .num{width:22px;height:22px;border-radius:50%;background:#000080;color:#fff;display:grid;place-items:center;font-weight:700;font-size:12px}
#l1-scenarii-v2 .step .hd .ti{font-weight:700;font-size:13px;color:var(--acc)}
#l1-scenarii-v2 .step .hd .meta{margin-left:auto;color:var(--mut);font-size:11px}
#l1-scenarii-v2 .step.collapsed .bd,#l1-scenarii-v2 .step.collapsed .bar{display:none}
#l1-scenarii-v2 .step .bd{padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
#l1-scenarii-v2 .step .col{display:flex;flex-direction:column;gap:6px;min-width:0}
#l1-scenarii-v2 .step .col .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);display:flex;align-items:center;gap:8px}
#l1-scenarii-v2 .step .col .lbl .sp{margin-left:auto;display:flex;gap:6px}
#l1-scenarii-v2 .step .sys{height:230px;overflow:auto;white-space:pre-wrap;font-size:12px;background:#fff;border:2px solid;border-color:#808080 #fff #fff #808080;border-radius:0;padding:10px 12px;color:#000;line-height:1.5;font-family:inherit}
#l1-scenarii-v2 .step .sys:focus{outline:none;border-color:#000080}
#l1-scenarii-v2 .step .sys mark.sub{background:#fff3b0;color:#7a4a00;font-weight:700}
#l1-scenarii-v2 .step .sys mark.sub2{background:#c8f0d8;color:#0a5a30;font-weight:700}
#l1-scenarii-v2 .hltleg{margin-left:8px;font-size:9.5px;text-transform:none;letter-spacing:0;color:var(--mut);font-weight:400}
#l1-scenarii-v2 .hltleg b{font-weight:700}
#l1-scenarii-v2 .step .sys mark.diff{background:#c8f0d8;color:#0a5a30;font-weight:600}
#l1-scenarii-v2 .step textarea.out{height:230px;font-size:12px}
#l1-scenarii-v2 .savescen-bar{display:flex;justify-content:flex-end;margin-top:8px}
/* currently-running step highlight (during Run all / Run-regenerate) */
#l1-scenarii-v2 .step.running{border-color:#000080}
#l1-scenarii-v2 .step.running .num{background:#000080;color:#fff;animation:plpulse 1.1s ease-in-out infinite}
@keyframes plpulse{0%,100%{box-shadow:0 0 0 0 rgba(0,0,128,.5)}50%{box-shadow:0 0 0 5px rgba(0,0,128,0)}}
#l1-scenarii-v2 .btn-sm{padding:3px 9px;font-size:11px;border-radius:2px}
#l1-scenarii-v2 .btn-sm.primary{background:#000080;border-color:#5a5af0 #00004a #00004a #5a5af0;color:#fff;font-weight:700}
#l1-scenarii-v2 .badge{font-size:10px;padding:2px 8px;border-radius:2px;background:#c8c4bc;border:1px solid #808080;color:#333}
#l1-scenarii-v2 .badge.ok{background:#d6f0de;color:#0a5a30;border-color:#7bbf95}
#l1-scenarii-v2 .badge.warn{background:#f5e6c0;color:#7a5a00;border-color:#caa85a}
#l1-scenarii-v2 .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px}
#l1-scenarii-v2 .msg{font-size:12px;color:var(--mut);min-height:16px}
#l1-scenarii-v2 .msg.err{color:var(--err)} #l1-scenarii-v2 .msg.ok{color:var(--ok)} #l1-scenarii-v2 .msg.run{color:var(--acc)}
#l1-scenarii-v2 .spin{display:inline-block;width:12px;height:12px;border:2px solid #808080;border-top-color:#000080;border-radius:50%;animation:plsp .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes plsp{to{transform:rotate(360deg)}}
#l1-scenarii-v2 .hint{font-size:11px;color:var(--mut)}
#l1-scenarii-v2 .castrow{display:inline-flex;align-items:center;gap:5px;background:#fff;border:2px solid;border-color:#808080 #fff #fff #808080;border-radius:2px;min-height:38px;padding:0 6px 0 10px}
#l1-scenarii-v2 .castrow .rnum{color:var(--mut);font-size:11px}
#l1-scenarii-v2 .castrow .rname{flex:0 0 108px;width:108px;background:transparent;border:none;border-radius:0;padding:4px 2px;color:#000;font-weight:600;font-size:12px}
#l1-scenarii-v2 .castrow .rg{flex:0 0 82px;padding:5px 8px;font-size:12px}
#l1-scenarii-v2 .castrow .rx{padding:1px 7px;font-size:11px;border-radius:2px;background:#d4d0c8;border:1px solid #808080}
#l1-scenarii-v2 .castrow .rx:hover{border-color:var(--err);color:var(--err)}
#l1-scenarii-v2 #castAdd{padding:5px 12px;font-size:12px;border-radius:2px}
#l1-scenarii-v2 .tog{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none;font-size:12px;color:var(--mut)}
#l1-scenarii-v2 .tog input{display:none}
#l1-scenarii-v2 .tog .sw{width:38px;height:20px;border-radius:999px;background:#808080;position:relative;transition:.15s}
#l1-scenarii-v2 .tog .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
#l1-scenarii-v2 .tog input:checked+.sw{background:#000080}
#l1-scenarii-v2 .tog input:checked+.sw::after{left:20px}
#l1-scenarii-v2 .notice{background:#f5e6c0;border:1px solid #caa85a;color:#7a5a00;padding:10px 14px;border-radius:2px;font-size:12px;margin-bottom:12px;display:none}
#l1-scenarii-v2 .mini-gear{padding:0;width:18px;height:18px;line-height:1;border-radius:50%;font-size:11px;background:#d4d0c8;border:1px solid #808080;color:#444;vertical-align:middle}
#l1-scenarii-v2 .mini-gear:hover{border-color:#000080;color:#000}
#l1-scenarii-v2 .lblrow{display:inline-flex;align-items:center;gap:6px}
#l1-scenarii-v2 .tip{display:inline-flex;width:15px;height:15px;border-radius:50%;border:1px solid #808080;color:var(--mut);font-size:10px;align-items:center;justify-content:center;cursor:help;position:relative}
#l1-scenarii-v2 .tip:hover::after{content:attr(data-tip);position:absolute;left:0;top:130%;width:320px;background:#ffffe1;border:1px solid #808080;border-radius:2px;padding:9px 11px;color:#000;font-size:11px;line-height:1.55;z-index:30;white-space:normal;box-shadow:2px 2px 6px rgba(0,0,0,.35)}
/* hook panel */
#l1-scenarii-v2 .hookpanel{background:#cfcbc3;border:2px solid;border-color:#808080 #fff #fff #808080;border-radius:0;padding:10px 12px}
#l1-scenarii-v2 .hookpanel .hh{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
#l1-scenarii-v2 .hookpanel .hh .sp{margin-left:auto;display:flex;gap:6px}
#l1-scenarii-v2 .hookrow{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:2px;border:1px solid transparent;margin-bottom:4px}
#l1-scenarii-v2 .hookrow.sel{border-color:#000080;background:#d0d8f0}
#l1-scenarii-v2 .hookrow .ht{flex:1;font-size:12px;line-height:1.45}
#l1-scenarii-v2 .hookrow .hooklen{color:var(--mut);font-size:10.5px}
#l1-scenarii-v2 .verSel{padding:3px 8px;font-size:11px;border-radius:2px}
/* modals */
#l1-scenarii-v2 .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:99970}
#l1-scenarii-v2 .modal-bg.open{display:flex}
#l1-scenarii-v2 .modal{background:var(--panel);border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;width:680px;max-width:94vw;max-height:88vh;overflow:auto;padding:18px 20px}
#l1-scenarii-v2 .modal h3{margin:0 0 4px;font-size:14px;color:var(--acc)}
#l1-scenarii-v2 .modal .msub{color:var(--mut);font-size:11.5px;margin:0 0 14px}
#l1-scenarii-v2 .ed{display:grid;grid-template-columns:200px 1fr;gap:14px}
#l1-scenarii-v2 .ed select[size]{width:100%;height:240px;border-radius:0!important;padding:5px!important;background-image:none!important;background-color:#fff!important}
#l1-scenarii-v2 .ed select[size] option{padding:7px 9px;border-radius:0;margin:1px 0}
#l1-scenarii-v2 .ed select[size] option:checked{background:#000080!important;color:#fff!important}
#l1-scenarii-v2 .ed .form{display:flex;flex-direction:column;gap:8px}
#l1-scenarii-v2 .ed .form textarea{height:120px}
#l1-scenarii-v2 .modal .foot{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
#l1-scenarii-v2 #libModal .modal{width:640px}
#l1-scenarii-v2 #libText{height:320px;font-size:12.5px;width:100%}
#l1-scenarii-v2 #optLibBtns{display:flex;gap:8px;margin-top:6px}
/* Saved view */
#l1-scenarii-v2 .pl-saved-wrap{max-width:1100px;margin:0 auto;padding:16px 20px 60px}
#l1-scenarii-v2 .pl-scard{background:var(--panel);border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px}
#l1-scenarii-v2 .pl-scard.arm{border-color:var(--err)}
#l1-scenarii-v2 .pl-scard .si{flex:1;min-width:0}
#l1-scenarii-v2 .pl-scard .st{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#l1-scenarii-v2 .pl-scard .ss{color:var(--mut);font-size:11.5px;margin-top:2px;display:flex;gap:8px;flex-wrap:wrap}
#l1-scenarii-v2 .pl-scard .sa{display:flex;gap:6px;flex-shrink:0}
#l1-scenarii-v2 .pl-empty{color:var(--mut);font-size:13px;text-align:center;padding:40px 0}
/* generic lab popup (preview / routing) */
#l1-scenarii-v2 .pl-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99975}
#l1-scenarii-v2 .pl-box{background:var(--panel);border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;width:760px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
#l1-scenarii-v2 .pl-box-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#000080;color:#fff;border-bottom:1px solid #808080;font-weight:700;font-size:13px}
#l1-scenarii-v2 .pl-box-bd{padding:14px 16px;overflow:auto}
#l1-scenarii-v2 .pl-line{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #b0aca4;font-size:12.5px}
#l1-scenarii-v2 .pl-line:last-child{border-bottom:none}
#l1-scenarii-v2 .pl-kind{flex:0 0 116px;font-size:10.5px}
#l1-scenarii-v2 .pl-kind .badge{display:inline-block}
#l1-scenarii-v2 .pl-ltext{flex:1;min-width:0;color:#000}
/* Saved master/detail popup */
#l1-scenarii-v2 .pl-sv-box{width:1040px;height:80vh;max-height:80vh}
#l1-scenarii-v2 .pl-sv-body{flex:1;min-height:0;display:flex}
#l1-scenarii-v2 .pl-sv-left{flex:0 0 320px;display:flex;flex-direction:column;border-right:1px solid #808080;min-height:0}
#l1-scenarii-v2 #svSearch{margin:10px 12px}
#l1-scenarii-v2 .pl-sv-list{flex:1;min-height:0;overflow:auto;padding:0 8px 10px}
#l1-scenarii-v2 .pl-sv-item{padding:9px 10px;border-radius:2px;cursor:pointer;border:1px solid transparent;margin-bottom:2px}
#l1-scenarii-v2 .pl-sv-item:hover{background:#d0d8f0}
#l1-scenarii-v2 .pl-sv-item.sel{background:#d0d8f0;border-color:#000080}
#l1-scenarii-v2 .pl-sv-item .t{font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#l1-scenarii-v2 .pl-sv-item .m{display:flex;gap:7px;align-items:center;color:var(--mut);font-size:10.5px;margin-top:3px}
#l1-scenarii-v2 .pl-sv-detail{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
#l1-scenarii-v2 .pl-sv-dhead{padding:14px 16px 10px;border-bottom:1px solid #808080;flex-shrink:0}
#l1-scenarii-v2 .pl-sv-dtitle{font-size:15px;font-weight:700;margin-bottom:6px}
#l1-scenarii-v2 .pl-sv-lines{flex:1;min-height:0;overflow:auto;padding:10px 16px}
#l1-scenarii-v2 .pl-sv-dfoot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #808080;flex-wrap:wrap;flex-shrink:0}
/* classic inputs (override the global pill theme inside the lab) */
#l1-scenarii-v2 select,
#l1-scenarii-v2 input[type=text],
#l1-scenarii-v2 input[type=number],
#l1-scenarii-v2 input:not([type]){
  background-color:#fff!important;border:2px solid!important;border-color:#808080 #fff #fff #808080!important;border-radius:2px!important;color:#000!important;box-shadow:none!important;padding:5px 8px!important}
#l1-scenarii-v2 .castrow .rname{background-color:transparent!important;border:none!important;padding:4px 2px!important}
#l1-scenarii-v2 .castrow .rg{height:auto!important;min-height:32px!important;padding:6px 8px!important}
#l1-scenarii-v2 textarea{background-color:#fff!important;border:2px solid!important;border-color:#808080 #fff #fff #808080!important;border-radius:2px!important;color:#000!important;padding:10px 12px!important}
#l1-scenarii-v2 select:focus,#l1-scenarii-v2 input:focus,#l1-scenarii-v2 textarea:focus{border-color:#000080!important;box-shadow:none!important}
#l1-scenarii-v2 select option{background-color:#fff!important;color:#000!important}
/* taller generation-parameter fields (dropdowns + inputs in the params card).
   A global app style pins select/input height:22px; override it so padding can grow the box. */
#l1-scenarii-v2 .card label.fld>select,#l1-scenarii-v2 .card label.fld>input{height:38px!important;min-height:38px!important;padding-top:7px!important;padding-bottom:7px!important}
#l1-scenarii-v2 .pl-inl>select{height:auto!important;min-height:28px!important}
@media(max-width:980px){#l1-scenarii-v2 .step .bd{grid-template-columns:1fr}#l1-scenarii-v2 .ed{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }

  // ════════════════════════════════════════════════════════════════════════
  // MARKUP
  // ════════════════════════════════════════════════════════════════════════
  function _build(){
    const root = ROOT();
    root.innerHTML = `
  <div class="pl-tabs">
    <button class="pl-tab on" id="plTabNew">🧪 New scenario</button>
    <label class="pl-inl"><span>Theme</span><select id="theme" title="Theme"></select></label>
    <label class="pl-inl"><span>Format</span><select id="format" title="Format" style="min-width:160px"></select></label>
    <label class="pl-inl"><span>Model</span>
      <select id="model" title="Model" style="min-width:140px">
        <option value="nousresearch/hermes-4-70b">Hermes 4 70B</option>
        <option value="nousresearch/hermes-4-405b">Hermes 4 405B</option>
        <option value="nousresearch/hermes-3-llama-3.1-70b">Hermes 3 70B</option>
      </select>
    </label>
    <span class="pl-tabs-sp"></span>
    <button class="pl-tab" id="plTabSaved">💾 Saved</button>
  </div>

  <div id="pl-new"><div class="wrap">

    <div class="card">
      <h2>Generation parameters</h2>
      <div class="row">
        <label class="fld" style="flex:2"><span>Title</span><input type="text" id="title" placeholder="auto…"></label>
        <label class="fld" style="flex:3"><span class="lblrow">Ingredients / props (the fake-recipe core) <span class="tip" id="ingTip" data-tip="">ⓘ</span></span><input type="text" id="ingredients" placeholder="e.g. baking soda, garlic, olive oil"></label>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="fld"><span class="lblrow">Vertical <button class="mini-gear" id="vertGear" title="Edit verticals">⚙</button></span><select id="vertical"></select></label>
        <label class="fld"><span class="lblrow">Taboo level <button class="mini-gear" id="tabooGear" title="Edit taboo levels">⚙</button></span>
          <select id="taboo">
            <option value="soft">soft</option>
            <option value="spicy" selected>spicy</option>
            <option value="hard">hard</option>
            <option value="extreme">extreme</option>
          </select>
        </label>
        <label class="fld"><span class="lblrow">Scenes <button class="mini-gear" id="scenesGear" title="Edit scene counts">⚙</button></span><select id="scenes"></select></label>
        <label class="fld"><span class="lblrow">Emotion <button class="mini-gear" id="emoGear" title="Edit emotions">⚙</button></span><select id="emotion"></select></label>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="fld" style="flex:1"><span>Cast &amp; gender <span class="hint">(role labels per type; pick gender — “any” lets the model choose; audience lives in the vertical)</span></span>
          <div id="castRows" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"></div>
        </label>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="fld" style="flex:1"><span>Notes (freeform — injected into the step-1 base brief)</span><textarea id="notes" style="height:54px" placeholder="e.g. set it on a beach · make the doctor German · 30-day deadline · add a skeptical wife · avoid mentioning price · mention a specific city"></textarea></label>
      </div>
      <div class="bar" style="margin-top:12px">
        <button class="primary" id="runAll">▶ Run all steps</button>
        <button id="reload">↻ Reload step prompts</button>
        <span class="hint">Changing type / taboo / vertical / scenes auto-reloads the prompts (discards manual prompt edits).</span>
      </div>
      <div class="msg" id="globalMsg"></div>
    </div>

    <div class="notice" id="noSteps"></div>
    <div id="steps"></div>
  </div></div>

  <!-- Generic option editor (verticals + emotions) -->
  <div class="modal-bg" id="optModal">
    <div class="modal">
      <h3 id="optTitle">⚙ Options</h3>
      <p class="msub" id="optSub"></p>
      <div class="ed">
        <select id="optList" size="10"></select>
        <div class="form">
          <label class="fld"><span>Label</span><input type="text" id="optLabel"></label>
          <label class="fld"><span id="optDescLbl">Description</span><textarea id="optDesc" style="height:150px"></textarea></label>
          <div style="display:flex;gap:8px">
            <button class="primary" id="optSave">💾 Save</button>
            <button id="optNew">＋ New</button>
            <button id="optDel" style="margin-left:auto;border-color:#5a2a2a;color:var(--err)">🗑 Delete</button>
          </div>
          <div id="optLibBtns" style="display:none">
            <button class="btn-sm" id="optHooksBtn">🪝 Hooks library</button>
            <button class="btn-sm" id="optCompBtn">🔁 Comparisons library</button>
          </div>
          <div class="msg" id="optMsg"></div>
        </div>
      </div>
      <div class="foot"><button id="optClose">Close</button></div>
    </div>
  </div>

  <!-- Taboo level editor -->
  <div class="modal-bg" id="tabModal">
    <div class="modal">
      <h3>⚙ Taboo levels</h3>
      <p class="msub">Edit what each intensity level allows. The strongest intensity levers are shown bold+yellow in the preview. Saved to <code>prompts/marketing/_taboo.md</code>.</p>
      <div class="ed">
        <select id="tabList" size="6"></select>
        <div class="form">
          <label class="fld"><span>Level text (sent verbatim when this level is chosen)</span><textarea id="tabText" style="height:170px"></textarea></label>
          <div class="sys" id="tabPrev" style="height:90px"></div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="primary" id="tabSave">💾 Save level</button>
            <span class="msg" id="tabMsg" style="margin-left:auto"></span>
          </div>
        </div>
      </div>
      <div class="foot"><button id="tabClose">Close</button></div>
    </div>
  </div>

  <!-- Scene-count editor -->
  <div class="modal-bg" id="scnModal">
    <div class="modal" style="width:440px">
      <h3>⚙ Scene counts</h3>
      <p class="msub">Ranges (min-max) offered for this format. Pick the default. Saved to <code>prompts/marketing/_types.json</code>.</p>
      <div id="scnRows" style="display:flex;flex-direction:column;gap:8px"></div>
      <button id="scnAdd" style="margin-top:10px">＋ add range</button>
      <div class="msg" id="scnMsg" style="margin-top:8px"></div>
      <div class="foot"><button class="primary" id="scnSave">💾 Save</button><button id="scnClose">Close</button></div>
    </div>
  </div>

  <!-- Per-vertical library editor (hooks / comparisons) -->
  <div class="modal-bg" id="libModal">
    <div class="modal">
      <h3 id="libTitle"></h3>
      <p class="msub" id="libSub"></p>
      <textarea id="libText"></textarea>
      <div class="msg" id="libMsg"></div>
      <div class="foot"><button class="primary" id="libSave">💾 Save</button><button id="libClose">Close</button></div>
    </div>
  </div>`;
    _wire();
  }

  // ── State helpers ───────────────────────────────────────────────────────
  function curCfg(){ return state.types.find(t=>t.id===state.type) || {}; }
  function defaultRoles(cfg){
    const p = ROLE_PRESETS[cfg.id]||[];
    const n = cfg.multi ? (cfg.charactersMax||cfg.characters||p.length||2) : (cfg.characters||0);
    if(n<=0) return [];
    return Array.from({length:n},(_,i)=>({id:'r'+i,name:p[i]||(n===1?'Presenter':'Role'+(i+1)),gender:'any'}));
  }
  function genderSel(val,on){
    const s=document.createElement('select'); s.className='rg';
    GENDERS.forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;s.appendChild(o);});
    s.value=val||'any'; s.onchange=e=>on(e.target.value); return s;
  }
  function renderCast(){
    const host=$('castRows'); if(!host) return; host.innerHTML='';
    const cfg=curCfg();
    if((cfg.characters||0)===0){
      const row=document.createElement('div'); row.className='castrow';
      const lab=document.createElement('span'); lab.className='rnum'; lab.textContent='🎙';
      const nm=document.createElement('span'); nm.className='rname'; nm.style.flex='0 0 auto'; nm.style.width='auto'; nm.textContent='Narrator';
      row.append(lab, nm, genderSel(state.narratorGender,v=>state.narratorGender=v));
      host.append(row); return;
    }
    const min=cfg.charactersMin||1, max=cfg.charactersMax||1;
    state.roles.forEach((r,i)=>{
      const row=document.createElement('div'); row.className='castrow';
      const num=document.createElement('span'); num.className='rnum'; num.textContent=(i+1)+'.';
      const name=document.createElement('input'); name.type='text'; name.className='rname'; name.value=r.name||''; name.placeholder='role';
      name.oninput=e=>{ state.roles[i].name=e.target.value; };
      name.onchange=()=>loadSteps();
      row.append(num, name, genderSel(r.gender,v=>{ state.roles[i].gender=v; loadSteps(); }));
      if(state.roles.length>min){ const x=document.createElement('button'); x.className='rx'; x.textContent='✕'; x.title='remove'; x.onclick=()=>{state.roles.splice(i,1);renderCast();loadSteps();}; row.append(x); }
      host.append(row);
    });
    if(cfg.multi && state.roles.length<max){
      const add=document.createElement('button'); add.id='castAdd'; add.textContent='＋ role';
      add.onclick=()=>{ const p=ROLE_PRESETS[cfg.id]||[]; state.roles.push({id:'r'+state.roles.length,name:p[state.roles.length]||('Role'+(state.roles.length+1)),gender:'any'}); renderCast(); loadSteps(); };
      host.append(add);
    }
    if(cfg.vo==='always'||cfg.vo==='optional'){
      const row=document.createElement('div'); row.className='castrow';
      const t1=document.createElement('span'); t1.className='rnum'; t1.textContent='🔊';
      const t2=document.createElement('span'); t2.className='rname'; t2.style.cssText='flex:0 0 auto;width:auto'; t2.textContent='[VO]';
      const tog=document.createElement('label'); tog.className='tog'; tog.style.margin='0';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!state.voEnabled;
      const sw=document.createElement('span'); sw.className='sw';
      tog.append(cb,sw);
      cb.onchange=()=>{ state.voEnabled=cb.checked; renderCast(); loadSteps(); };
      row.append(t1,t2,tog);
      if(state.voEnabled) row.append(genderSel(state.voGender,v=>{ state.voGender=v; loadSteps(); }));
      host.append(row);
    }
  }

  function gp(){
    return {
      theme: state.theme, type: state.type,
      title: $('title').value.trim(),
      vertical: $('vertical').value,
      taboo: $('taboo').value,
      scenesRange: $('scenes').value,
      model: $('model').value,
      roles: (curCfg().characters>0) ? state.roles.map((r,i)=>({id:r.id||('r'+i),name:r.name,gender:r.gender||'any'})) : undefined,
      narratorGender: (curCfg().characters===0) ? state.narratorGender : undefined,
      voEnabled: state.voEnabled,
      voGender: state.voGender,
      structured: {
        vertical: $('vertical').selectedOptions[0]?.textContent || '',
        emotion: $('emotion').value,
        ingredients: $('ingredients').value.trim(),
      },
      notes: $('notes').value.trim(),
    };
  }

  async function loadConfig(){
    const r = await fetch(`${API}/config?theme=${encodeURIComponent(state.theme)}`).then(x=>x.json());
    state.types = r.types || [];
    const th=$('theme'); th.innerHTML=(r.themes&&r.themes.length?r.themes:[state.theme]).map(t=>`<option value="${t}">${t}</option>`).join(''); th.value=state.theme;
    const fmt=$('format'); fmt.innerHTML='';
    state.types.forEach(t=>{
      if(HIDDEN_TYPES.includes(t.id)) return;
      const o=document.createElement('option'); o.value=t.id;
      if(PAUSED_TYPES.includes(t.id)){ o.disabled=true; o.textContent='⏸ '+(t.label||t.id)+' — paused'; }
      else o.textContent=t.label||t.id;
      fmt.appendChild(o);
    });
    if(HIDDEN_TYPES.includes(state.type)||PAUSED_TYPES.includes(state.type)||!state.types.some(t=>t.id===state.type)){
      const first=state.types.find(t=>!HIDDEN_TYPES.includes(t.id)&&!PAUSED_TYPES.includes(t.id));
      state.type = first ? first.id : 'ugc_ad';
    }
    fmt.value=state.type;
    fillVerticals(r.verticals||[]);
    fillEmotions(r.emotions||[]);
    $('ingTip').dataset.tip = INGREDIENT_EXAMPLES;
    applyTypeDefaults();
    autoTitle();
    await loadSteps();
  }
  function fillEmotions(list){
    const cur=$('emotion').value;
    $('emotion').innerHTML = '<option value="">— none —</option>' + list.map(e=>`<option value="${e.id}">${(e.label||e.id).replace(/^\S+\s/,'')}</option>`).join('');
    if(cur) $('emotion').value=cur;
  }
  function fillVerticals(list){
    const cur=$('vertical').value;
    $('vertical').innerHTML=(list||[]).map(v=>`<option value="${v.id}">${v.label}</option>`).join('');
    if(cur && (list||[]).some(v=>v.id===cur)) $('vertical').value=cur;
  }
  function applyTypeDefaults(){
    const t = state.types.find(x=>x.id===state.type) || {};
    const ranges = t.sceneRanges || ['15-18','17-21','20-25'];
    $('scenes').innerHTML = ranges.map(x=>`<option value="${x}"${x===(t.defaultSceneRange||ranges[0])?' selected':''}>${x}</option>`).join('');
    if(t.tabooDefault) $('taboo').value = t.tabooDefault;
    state.roles = defaultRoles(t);
    state.narratorGender = 'any';
    state.voEnabled = (t.vo==='always') ? true : (t.vo==='optional' ? !!t.voDefault : false);
    state.voGender = 'any';
    renderCast();
  }
  function selectType(id){ state.type=id; applyTypeDefaults(); autoTitle(); loadSteps(); }
  function verticalLabel(){ return $('vertical').selectedOptions[0]?.textContent || ''; }
  function autoTitle(){
    const t=$('title'); if(!t || t.dataset.dirty==='1') return;
    t.value = `${verticalLabel() || 'untitled'} — ${state.type}`;
  }

  async function loadSteps(){
    const p=gp();
    const r = await fetch(`${API}/lab/steps`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({theme:p.theme,type:p.type,taboo:p.taboo,vertical:p.vertical,scenesRange:p.scenesRange,roles:p.roles,voEnabled:p.voEnabled,voGender:p.voGender,narratorGender:p.narratorGender,structured:p.structured,notes:p.notes})}).then(x=>x.json());
    state.steps = r.steps||[];
    state.soh = r.soh||''; state.stx = r.stx||''; state.soh2 = r.soh2||''; state.stx2 = r.stx2||''; state.prevMark = r.prevMark||''; state.sep = r.sep||'';
    const notice=$('noSteps');
    if(!r.hasSteps){ notice.style.display='block'; notice.textContent=`⚠ This type has no step files yet (prompts/marketing/steps/${p.type}.step*.md). Showing what exists.`; }
    else notice.style.display='none';
    state.raw={}; state.tpl={}; state.versions={};
    renderSteps();
  }
  function fillPrompt(n, draft){
    const tpl=state.tpl[n]; if(tpl==null) return;
    const filled = state.prevMark ? tpl.split(state.prevMark).join(draft||'') : tpl;
    const el=$('sys'+n); if(el) el.innerHTML = hl(filled);
  }
  function hl(sys){
    let h=esc(sys);
    try{
      // vertical-library values first (teal), then the regular params (yellow)
      if(state.soh2&&state.stx2) h=h.replace(new RegExp(state.soh2+'([\\s\\S]*?)'+state.stx2,'g'),'<mark class="sub2">$1</mark>');
      if(state.soh&&state.stx)   h=h.replace(new RegExp(state.soh+'([\\s\\S]*?)'+state.stx,'g'),'<mark class="sub">$1</mark>');
    }catch{}
    return h;
  }
  function stepMsg(n,t,cls){ const m=$('msg'+n); if(m){ m.className='msg '+(cls||''); m.textContent=t||''; } }

  function renderSteps(){
    const host=$('steps'); host.innerHTML='';
    const last=state.steps.length;
    state.steps.forEach((s)=>{
      const isLast = s.n===last;
      const card=document.createElement('div');
      card.className='step s'+s.n+(isLast?'':' collapsed');
      card.dataset.step=s.n;
      card.innerHTML=`
        <div class="hd" data-toggle="${s.n}">
          <span class="chev">▸</span>
          <div class="num">${s.n}</div>
          <div class="ti">${s.title}</div>
          <div class="meta" id="meta${s.n}"></div>
        </div>
        <div class="bd">
          <div class="col">
            <div class="lbl">Full prompt — sent as ONE user message (editable)<span class="hltleg"><b style="color:#ffd24a">params</b> · <b style="color:#5be6b0">vertical library</b></span>
              <span class="sp"><select class="verSel" id="ver${s.n}" style="display:none" title="saved versions"></select><button class="btn-sm" data-save="${s.n}">💾 Save prompt</button></span>
            </div>
            <div class="sys" id="sys${s.n}" contenteditable="true" spellcheck="false"></div>
          </div>
          <div class="col">
            <div class="lbl">Result <span id="cnt${s.n}"></span></div>
            ${isLast?`<div class="hookpanel"><div class="hh">🪝 Hook (scene 1) — auto-generated; ◉ use sets line 1<span class="sp"><button class="btn-sm" id="hookGen" style="${state.hooks.length?'':'display:none'}">♻ Regenerate hooks</button></span></div><div id="hookList"></div><div class="msg" id="hookMsg"></div></div>`:''}
            <textarea class="out" id="out${s.n}" placeholder="${s.n===1?'clean script appears here — saveable at any step':'feeds from step '+(s.n-1)+'; hand-edit before running if you like'}"></textarea>
            <div class="savescen-bar"><button class="btn-sm primary" data-savescen="${s.n}">💾 Save scenario</button></div>
          </div>
        </div>
        <div class="bar" style="padding:0 16px 14px">
          <button class="primary" data-run="${s.n}">${isLast?'♻ Run / regenerate':('▶ Run step '+s.n)}</button>
          ${s.n>1?`<button data-pull="${s.n}">⬇ Insert step ${s.n-1} draft</button>`:''}
          <span class="msg" id="msg${s.n}"></span>
        </div>`;
      host.appendChild(card);
      state.tpl[s.n]=s.prompt;
      card.querySelector('.sys').innerHTML = hl(s.prompt);
      renderVersions(s.n);
    });
    host.querySelectorAll('[data-run]').forEach(b=>{ const n=+b.dataset.run; b.onclick=(n===state.steps.length)?(()=>runAll(b)):(()=>runStep(n)); });
    host.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>saveStep(+b.dataset.save));
    host.querySelectorAll('[data-savescen]').forEach(b=>b.onclick=()=>saveScenario(+b.dataset.savescen));
    host.querySelectorAll('[data-pull]').forEach(b=>b.onclick=()=>{ const n=+b.dataset.pull; const pe=$('out'+(n-1)); const draft=(pe.value.trim()&&pe.value!==pe.dataset.clean)?pe.value.trim():(state.raw[n-1]||pe.value.trim()); fillPrompt(n,draft); });
    host.querySelectorAll('.hd[data-toggle]').forEach(h=>h.onclick=()=>h.closest('.step').classList.toggle('collapsed'));
    if($('hookGen')) $('hookGen').onclick=genHooks;
    renderHookList();
  }

  async function runStep(n){
    const p=gp();
    const promptText=$('sys'+n).innerText.trim();
    const msg=$('msg'+n);
    let prevText='';
    if(n>1){
      const pe=$('out'+(n-1));
      const edited = pe.value.trim() && pe.value!==pe.dataset.clean;
      prevText = edited ? pe.value.trim() : (state.raw[n-1] || pe.value.trim());
      if(promptText.includes(state.prevMark) && !prevText){ msg.className='msg err'; msg.textContent=`Run step ${n-1} first (no input).`; return; }
    }
    msg.className='msg run'; msg.innerHTML='<span class="spin"></span>generating…';
    _setBusy(true);
    try{
      const isLast = n===state.steps.length;
      const body={ theme:p.theme,type:p.type,step:n,prompt:promptText,model:p.model,scenesRange:p.scenesRange,roles:p.roles,prevText,
        narratorGender:p.narratorGender, voEnabled:p.voEnabled, voGender:p.voGender,
        hook: isLast ? (state.chosenHook||'') : undefined };
      const r=await fetch(`${API}/lab/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
      if(!r.success) throw new Error(r.error||'failed');
      const pe=$('out'+n);
      pe.value=r.clean; pe.dataset.clean=r.clean;
      state.raw[n]=r.text;
      if(state.tpl[n+1]!=null && $('sys'+(n+1))) fillPrompt(n+1, r.text);
      const cnt=$('cnt'+n);
      const want=p.scenesRange;
      const mm=String(want).match(/(\d+)\s*-\s*(\d+)/);
      const inRange = mm ? (r.lineCount>=+mm[1] && r.lineCount<=+mm[2]) : true;
      cnt.innerHTML=`<span class="badge ${inRange?'ok':'warn'}">${r.lineCount} lines${inRange?'':' ⚠'}</span> <span class="badge">target ${want}</span>`;
      msg.className='msg ok'; msg.textContent=`done — ${r.lineCount} lines${r.toppedUp?` (topped up ${r.toppedUp}×)`:''}.`;
      if(isLast){ try{ await genHooks(); }catch(e){} }   // finalization: auto-generate 4 hooks, first fills scene 1
      return r;
    }catch(e){ msg.className='msg err'; msg.textContent='✗ '+e.message; throw e; }
    finally{ if(!_piping) _setBusy(false); }   // during a pipeline, runAll keeps buttons busy until the end
  }

  // Busy-state: disable run + save buttons (incl. the top #runAll) while generating.
  let _piping=false;
  function _setBusy(on){ $$('[data-run],[data-savescen],#runAll').forEach(b=>{ b.disabled=!!on; }); }
  function _markRunning(n,on){ const c=$('steps')?.querySelector(`.step[data-step="${n}"]`); if(c) c.classList.toggle('running', !!on); }
  // Run the whole pipeline. The progress (spinner + step X/N) shows ON the button
  // the user clicked (top "Run all steps" OR the bottom "Run / regenerate"), and
  // the currently-running step card is highlighted.
  async function runAll(srcBtn){
    if(_piping) return;                  // guard against nested pipelines (double-click)
    _piping=true; _setBusy(true);
    const total=state.steps.length;
    const btn = srcBtn || $('runAll');
    const orig = btn ? btn.innerHTML : '';
    const g=$('globalMsg'); if(g) g.className='msg run';
    try{
      for(const s of state.steps){
        if(btn) btn.innerHTML=`<span class="spin"></span> step ${s.n}/${total}`;
        if(g) g.innerHTML=`<span class="spin"></span>running pipeline — step ${s.n}/${total}`;
        _markRunning(s.n,true);
        try{ await runStep(s.n); } finally { _markRunning(s.n,false); }
      }
      if(btn) btn.innerHTML=orig;
      if(g){ g.className='msg ok'; g.textContent='✓ pipeline complete — final script is in the last step.'; }
    }catch(e){ if(btn) btn.innerHTML=orig; if(g){ g.className='msg err'; g.textContent='✗ stopped: '+e.message; } }
    finally{ _piping=false; _setBusy(false); }
  }

  // ── Save a step's clean script as a scenario in the store ─────────────────
  function parseLines(text, roles, multi){
    const names=roles.map(r=>(r.name||'').toLowerCase());
    return text.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
      if(multi){
        const m=line.match(/^\[\s*([^\]]{1,30})\s*\]\s*(.*)$/);
        if(m){ const idx=names.indexOf(m[1].trim().toLowerCase()); return {text:(m[2].trim()||line), roleId:(idx>=0?roles[idx].id:(roles[0]&&roles[0].id)||'r0'), propFile:null}; }
      }
      return {text:line, roleId:(roles[0]&&roles[0].id)||'r0', propFile:null};
    });
  }
  async function saveScenario(n){
    const p=gp(); const cfg=curCfg();
    const text=$('out'+n).value.trim();
    if(!text){ stepMsg(n,'Run or write a script first.','err'); return; }
    const multi=!!cfg.multi;
    const mode=(cfg.characters===0)?'voiceover':(multi?'multi':'single');
    const roles=(cfg.characters>0)? state.roles.map((r,i)=>({id:r.id||('r'+i),name:r.name,gender:r.gender||'any'})) : [];
    const payload={
      title:(p.title || `${verticalLabel()} — ${p.type}`)+` · step ${n}`,
      theme:p.theme, type:p.type, mode,
      taboo:p.taboo, naming:'off',
      vertical:{id:p.vertical, label:verticalLabel()},
      ingredients:$('ingredients').value.trim(),
      emotion:$('emotion').value,
      scenesRange:p.scenesRange,
      notes:$('notes').value.trim(),
      narratorGender:(cfg.characters===0)?state.narratorGender:undefined,
      voGender:(cfg.vo==='always'||cfg.vo==='optional')&&state.voEnabled?state.voGender:undefined,
      voEnabled:state.voEnabled,
      charactersCount:roles.length,
      roles,
      lines:parseLines(text, roles.length?roles:[{id:'r0'}], multi),
      hook:state.chosenHook||'',
      sourcePipeline:'lab', sourceStep:n,
    };
    stepMsg(n,'saving…','run');
    try{
      const r=await fetch(`${API}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(x=>x.json());
      stepMsg(n, r.success?'scenario saved ✓':('✗ '+(r.error||'save failed')), r.success?'ok':'err');
      if(r.success){ await openSavedPopup(r.scenario&&r.scenario.id); }   // open Saved popup on the new scenario
    }catch(e){ stepMsg(n,'✗ '+e.message,'err'); }
  }

  async function saveStep(n){
    const p=gp(); const content=$('sys'+n).innerText;
    const msg=$('msg'+n); msg.className='msg run'; msg.textContent='saving…';
    const r=await fetch(`${API}/lab/save-step`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({theme:p.theme,type:p.type,n,content,taboo:p.taboo,vertical:p.vertical,scenesRange:p.scenesRange,emotion:p.structured.emotion,roles:p.roles,voEnabled:p.voEnabled,voGender:p.voGender,narratorGender:p.narratorGender})}).then(x=>x.json());
    if(r.success){
      state.versions[n]=state.versions[n]||[];
      state.versions[n].push({label:new Date().toLocaleTimeString('en-GB').slice(0,5), content});
      renderVersions(n);
      msg.className='msg ok'; msg.textContent=`prompt saved ✓ (placeholders preserved) · v${state.versions[n].length}`;
    } else { msg.className='msg err'; msg.textContent='save failed'; }
  }

  // ── Prompt versioning + diff highlight ────────────────────────────────────
  function renderVersions(n){
    const sel=$('ver'+n); if(!sel) return;
    const vs=state.versions[n]||[];
    if(!vs.length){ sel.style.display='none'; return; }
    sel.style.display='';
    sel.innerHTML='<option value="">▾ versions ('+vs.length+')</option>'+vs.map((v,i)=>`<option value="${i}">v${i+1} · ${v.label}</option>`).join('');
    sel.onchange=()=>{ if(sel.value==='') return; restoreVersion(n,+sel.value); sel.value=''; };
  }
  function restoreVersion(n,i){
    const vs=state.versions[n]; const v=vs&&vs[i]; if(!v) return;
    const prev = i>0 ? vs[i-1].content : '';
    $('sys'+n).innerHTML = diffHl(v.content, prev);
    stepMsg(n, `showing v${i+1} (changed lines highlighted green)`, 'ok');
  }
  function diffHl(text, prevText){
    const prevSet=new Set(String(prevText||'').split('\n').map(l=>l.trim()).filter(Boolean));
    return String(text||'').split('\n').map(l=>{
      const e=esc(l);
      return (l.trim() && !prevSet.has(l.trim())) ? '<mark class="diff">'+e+'</mark>' : e;
    }).join('\n');
  }

  // ── Hook field (finalization) ─────────────────────────────────────────────
  // Replace the first non-empty line (scene 1) of the finalization result with the hook.
  function applyHookToScript(h){
    const lastN=state.steps.length; const out=$('out'+lastN); if(!out) return;
    const lines=out.value.split('\n');
    const idx=lines.findIndex(l=>l.trim()!=='');
    if(idx<0){ out.value=h; } else { lines[idx]=h; out.value=lines.join('\n'); }
    out.dataset.clean=out.value;
  }
  async function genHooks(){
    const p=gp(); const m=$('hookMsg'); const btn=$('hookGen');
    const lastN=state.steps.length;
    const scriptText=(($('out'+lastN)&&$('out'+lastN).value)||'').trim();
    m.className='msg run'; m.innerHTML='<span class="spin"></span>generating hooks…'; if(btn) btn.disabled=true;
    try{
      const r=await fetch(`${API}/lab/hooks`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({theme:p.theme,vertical:p.vertical,taboo:p.taboo,roles:p.roles,narratorGender:p.narratorGender,model:p.model,script:scriptText})}).then(x=>x.json());
      if(!r.success) throw new Error(r.error||'failed');
      state.hooks=r.hooks||[];
      if(state.hooks.length){ state.chosenHook=state.hooks[0]; applyHookToScript(state.hooks[0]); }   // first hook auto-fills scene 1
      renderHookList();
      m.className='msg ok'; m.textContent=`${state.hooks.length} hooks — first one is in scene 1. ◉ use to switch, ⭐ to save, ♻ to regenerate.`;
    }catch(e){ m.className='msg err'; m.textContent='✗ '+e.message; }
    finally{ if(btn) btn.disabled=false; }
  }
  function renderHookList(){
    const hg=$('hookGen'); if(hg) hg.style.display = (state.hooks&&state.hooks.length) ? '' : 'none';
    const host=$('hookList'); if(!host) return; host.innerHTML='';
    (state.hooks||[]).forEach(h=>{
      const row=document.createElement('div'); row.className='hookrow'+(state.chosenHook===h?' sel':'');
      const txt=document.createElement('div'); txt.className='ht'; txt.innerHTML=esc(h)+` <span class="hooklen">(${h.length})</span>`;
      const pick=document.createElement('button'); pick.className='btn-sm'; pick.textContent=state.chosenHook===h?'◉ in scene 1':'◉ use';
      pick.onclick=()=>{ state.chosenHook=h; applyHookToScript(h); renderHookList(); };   // swap scene 1 to this hook
      const star=document.createElement('button'); star.className='btn-sm'; star.textContent='⭐'; star.title='save to vertical hooks base';
      star.onclick=()=>saveHookToBase(h);
      row.append(txt,pick,star); host.append(row);
    });
  }
  async function saveHookToBase(h){
    const p=gp();
    const r=await fetch(`${API}/hooks/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:p.theme,vertical:p.vertical,hook:h})}).then(x=>x.json());
    const m=$('hookMsg'); m.className='msg ok'; m.textContent=r.added?'⭐ saved to the vertical hooks base':'already in the base';
  }

  // ── Guarded param change ──────────────────────────────────────────────────
  function hasOutput(){ return (state.steps||[]).some(s=>{ const o=$('out'+s.n); return o && o.value.trim(); }); }
  function bindGuarded(id){
    const el=$(id); if(!el) return;
    el.addEventListener('focus',()=>{ el.dataset.prev=el.value; });
    el.addEventListener('change',()=>{
      if(hasOutput() && !confirm('Changing this parameter will discard the generated results. Continue?')){ el.value=el.dataset.prev||el.value; return; }
      el.dataset.prev=el.value;
      if(id==='vertical'){ state.hooks=[]; state.chosenHook=''; autoTitle(); }
      loadSteps();
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // EDITORS (verticals/emotions, taboo, scenes, libraries)
  // ════════════════════════════════════════════════════════════════════════
  let _libKind='hooks', _libVid='';
  async function openLib(kind, vid, label){
    _libKind=kind; _libVid=vid;
    const isHooks=kind==='hooks';
    $('libTitle').textContent=(isHooks?'🪝 Hooks — ':'🔁 Comparisons — ')+(label||vid);
    $('libSub').textContent=isHooks
      ? 'One hook per line (≤120 chars with spaces). Used as style anchors and by the finalization hook generator.'
      : 'One mapping per line, e.g. "plain phrase -> punchy, native analogue". Woven into the voice and finalization passes.';
    const url=isHooks
      ? `${API}/hooks?theme=${encodeURIComponent(state.theme)}&vertical=${encodeURIComponent(vid)}`
      : `${API}/comparisons?theme=${encodeURIComponent(state.theme)}&vertical=${encodeURIComponent(vid)}`;
    const r=await fetch(url).then(x=>x.json());
    const arr=isHooks?(r.hooks||[]):(r.comparisons||[]);
    $('libText').value=arr.join('\n'); $('libMsg').textContent=''; $('libModal').classList.add('open');
  }

  let _opts=[], _optKind='emotions';
  const OPT_META={
    emotions:{title:'⚙ Emotions', sub:'Tonal modifiers. Label shows in the dropdown; description steers the model. Saved to emotions.json.', desc:'Description (how it colours the tone)'},
    verticals:{title:'⚙ Verticals', sub:'Each niche. Put the AUDIENCE AGE, symptoms, desires and common angles in the description. Saved to verticals.json.', desc:'Description (niche, audience age, symptoms, common angles)'},
  };
  function optMsg(t,cls){ const m=$('optMsg'); m.className='msg '+(cls||''); m.textContent=t||''; }
  function renderOptList(sel){
    const list=$('optList'); list.innerHTML='';
    _opts.forEach(o=>{ const op=document.createElement('option'); op.value=o.id; op.textContent=o.label||o.id; list.appendChild(op); });
    if(sel){ list.value=sel; loadOpt(sel); } else loadOpt('');
  }
  function loadOpt(id){ const o=_opts.find(x=>x.id===id); $('optLabel').value=o?o.label:''; $('optDesc').value=o?o.desc||'':''; $('optLabel').dataset.id=o?o.id:''; }
  function refreshOptDropdown(){ if(_optKind==='emotions') fillEmotions(_opts); else fillVerticals(_opts); }
  async function openOptEditor(kind){
    _optKind=kind;
    const m=OPT_META[kind]; $('optTitle').textContent=m.title; $('optSub').textContent=m.sub; $('optDescLbl').textContent=m.desc;
    $('optLibBtns').style.display = kind==='verticals' ? 'flex' : 'none';
    const r=await fetch(`${API}/options?theme=${encodeURIComponent(state.theme)}&kind=${kind}`).then(x=>x.json());
    _opts=r.options||[];
    renderOptList(_opts[0]&&_opts[0].id);
    optMsg(''); $('optModal').classList.add('open');
  }

  let _tabs=[];
  const TABOO_HL=/\b(crude(?:st)?|slang|graphic|explicit|shock(?:ing)?|raw|unfiltered|maximum|extreme|shameless|taboo|no softening|softening|body parts?|family[- ]adjacent|the most graphic)\b/gi;
  function tabMsg(t,cls){ const m=$('tabMsg'); m.className='msg '+(cls||''); m.textContent=t||''; }
  function renderTabPrev(){ $('tabPrev').innerHTML = esc($('tabText').value).replace(TABOO_HL,'<mark class="sub">$&</mark>'); }
  function loadTab(key){ const t=_tabs.find(x=>x.key===key); $('tabText').value=t?t.text:''; $('tabText').dataset.key=key; renderTabPrev(); }
  async function openTabEditor(){
    const r=await fetch(`${API}/taboo?theme=${encodeURIComponent(state.theme)}`).then(x=>x.json());
    _tabs=r.levels||[];
    const list=$('tabList'); list.innerHTML='';
    _tabs.forEach(t=>{ const o=document.createElement('option'); o.value=t.key; o.textContent=t.key; list.appendChild(o); });
    const cur=$('taboo').value; const pick=_tabs.some(t=>t.key===cur)?cur:(_tabs[0]&&_tabs[0].key);
    if(pick){ list.value=pick; loadTab(pick); }
    tabMsg(''); $('tabModal').classList.add('open');
  }

  function scnMsg(t,cls){ const m=$('scnMsg'); m.className='msg '+(cls||''); m.textContent=t||''; }
  function addScnRow(val, def){
    const host=$('scnRows');
    const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;align-items:center';
    const radio=document.createElement('input'); radio.type='radio'; radio.name='scnDef'; if(def) radio.checked=true;
    const inp=document.createElement('input'); inp.type='text'; inp.value=val||''; inp.placeholder='12-16'; inp.className='scnInp'; inp.style.flex='1';
    const x=document.createElement('button'); x.textContent='✕'; x.className='btn-sm'; x.onclick=()=>row.remove();
    row.append(radio, inp, x); host.append(row);
  }
  function openScnEditor(){
    const t=curCfg();
    const ranges=(t.sceneRanges||[]).slice(); const def=t.defaultSceneRange||ranges[0]||'';
    $('scnRows').innerHTML=''; ranges.forEach(r=>addScnRow(r, r===def)); if(!ranges.length) addScnRow('', true);
    scnMsg(''); $('scnModal').classList.add('open');
  }

  // ════════════════════════════════════════════════════════════════════════
  // SAVED — master/detail popup (list left, selected scenario right)
  // ════════════════════════════════════════════════════════════════════════
  function typeLabel(id){ const t=state.types.find(x=>x.id===id); return (t&&t.label)||id; }
  function _dateStr(iso){ if(!iso) return ''; try{ return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); }catch{ return ''; } }

  let _saved=null;   // { ov, list, selId, search }
  function _svq(sel){ return (_saved&&_saved.ov)?_saved.ov.querySelector(sel):null; }
  function closeSaved(){ if(_saved&&_saved.ov){ _saved.ov.remove(); _saved=null; } }

  async function openSavedPopup(preferId){
    let list=[];
    try{ const d=await fetch(`${API}/list`).then(r=>r.json()); list=(d.success?d.scenarios:[])||[]; }catch{}
    const ov=document.createElement('div'); ov.className='pl-ov';
    ov.onmousedown=e=>{ if(e.target===ov) closeSaved(); };
    const box=document.createElement('div'); box.className='pl-box pl-sv-box';
    box.innerHTML=`
      <div class="pl-box-hd"><span style="flex:1">💾 Saved scenarios</span><button class="btn-sm" id="svClose">✕</button></div>
      <div class="pl-sv-body">
        <div class="pl-sv-left">
          <input type="text" id="svSearch" placeholder="search by title…">
          <div class="pl-sv-list" id="svList"></div>
        </div>
        <div class="pl-sv-detail" id="svDetail"></div>
      </div>`;
    ov.append(box); (ROOT()||document.body).append(ov);
    const wantId=(preferId!=null && list.some(s=>String(s.id)===String(preferId))) ? preferId : (list[0]&&list[0].id);
    _saved={ ov, list, selId:(wantId!=null?wantId:null), search:'' };
    box.querySelector('#svClose').onclick=closeSaved;
    box.querySelector('#svSearch').addEventListener('input',e=>{ _saved.search=e.target.value.toLowerCase(); renderSavedList(); });
    renderSavedList();
    if(_saved.selId!=null) await selectSaved(_saved.selId);
    else _svq('#svDetail').innerHTML='<div class="pl-empty">No saved scenarios yet.<br>Generate one and hit 💾 Save scenario.</div>';
  }

  function renderSavedList(){
    const host=_svq('#svList'); if(!host) return; host.innerHTML='';
    const q=_saved.search;
    const items=_saved.list.filter(s=>!q||String(s.title||'').toLowerCase().includes(q));
    if(!items.length){ host.innerHTML='<div class="pl-empty" style="padding:18px 8px">nothing found</div>'; return; }
    items.forEach(s=>{
      const it=document.createElement('div'); it.className='pl-sv-item'+(String(s.id)===String(_saved.selId)?' sel':'');
      it.innerHTML=`<div class="t">${esc(s.title||'(untitled)')}</div><div class="m"><span class="badge">${esc(typeLabel(s.type))}</span><span>${s.sceneCount||0} ln</span><span>${_dateStr(s.updatedAt||s.createdAt)}</span></div>`;
      it.onclick=()=>selectSaved(s.id);
      host.append(it);
    });
  }

  async function selectSaved(id){
    _saved.selId=id; renderSavedList();
    const det=_svq('#svDetail'); if(!det) return;
    det.innerHTML='<div class="pl-empty">Loading…</div>';
    let s=null; try{ const d=await fetch(`${API}/${encodeURIComponent(id)}`).then(r=>r.json()); if(d.success) s=d.scenario; }catch{}
    if(!s){ det.innerHTML='<div class="pl-empty">Failed to load.</div>'; return; }
    det.innerHTML='';
    const head=document.createElement('div'); head.className='pl-sv-dhead';
    head.innerHTML=`<div class="pl-sv-dtitle">${esc(s.title||'(untitled)')}</div>
      <div class="ss"><span class="badge">${esc(typeLabel(s.type))}</span><span>vertical: ${esc((s.vertical&&s.vertical.label)||'—')}</span><span>taboo: ${esc(s.taboo||'—')}</span><span>${(s.lines||[]).length} lines</span></div>`;
    det.append(head);
    const lines=document.createElement('div'); lines.className='pl-sv-lines';
    (s.lines||[]).forEach((ln,i)=>{
      const row=document.createElement('div'); row.className='pl-line';
      const badge=i===0?'<span class="badge warn">🪝 1</span>':`<span class="badge">${i+1}</span>`;
      row.innerHTML=`<div class="pl-kind">${badge}</div><div class="pl-ltext">${esc(ln.text||'')}</div>`;
      lines.append(row);
    });
    det.append(lines);
    const foot=document.createElement('div'); foot.className='pl-sv-dfoot';
    const bEdit=document.createElement('button'); bEdit.className='btn-sm primary'; bEdit.textContent='⬈ Send to Edit'; bEdit.onclick=()=>sendToEdit(s);
    const bLoad=document.createElement('button'); bLoad.className='btn-sm'; bLoad.textContent='✎ Load into editor'; bLoad.onclick=()=>{ loadScenarioIntoEditor(s); closeSaved(); };
    const bDup=document.createElement('button'); bDup.className='btn-sm'; bDup.textContent='⧉ Duplicate'; bDup.onclick=()=>duplicateSaved(s.id);
    const bDel=document.createElement('button'); bDel.className='btn-sm'; bDel.style.color='var(--err)'; bDel.textContent='🗑 Delete'; bDel.onclick=()=>deleteSaved(s.id, bDel);
    foot.append(bEdit, bLoad, bDup, bDel);
    det.append(foot);
  }

  async function duplicateSaved(id){
    try{
      const d=await fetch(`${API}/${encodeURIComponent(id)}`).then(r=>r.json());
      if(!d.success) return;
      const s={...d.scenario}; delete s.id; delete s.createdAt; delete s.updatedAt;
      s.title=(s.title||'untitled')+' (copy)';
      const r=await fetch(`${API}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).then(x=>x.json());
      const d2=await fetch(`${API}/list`).then(x=>x.json()); _saved.list=(d2.success?d2.scenarios:[])||[];
      if(r.success&&r.scenario) _saved.selId=r.scenario.id;
      renderSavedList(); if(_saved.selId!=null) selectSaved(_saved.selId);
    }catch{}
  }
  function deleteSaved(id, btn){
    if(!btn.dataset.armed){ btn.dataset.armed='1'; btn.textContent='🗑 Confirm'; setTimeout(()=>{ try{ btn.dataset.armed=''; btn.textContent='🗑 Delete'; }catch{} }, 2200); return; }
    fetch(`${API}/${encodeURIComponent(id)}`,{method:'DELETE'}).then(()=>{
      _saved.list=_saved.list.filter(x=>String(x.id)!==String(id));
      const next=_saved.list[0]; _saved.selId=next?next.id:null;
      renderSavedList();
      if(_saved.selId!=null) selectSaved(_saved.selId);
      else { const det=_svq('#svDetail'); if(det) det.innerHTML='<div class="pl-empty">No saved scenarios left.</div>'; }
    }).catch(()=>{});
  }

  // ✎ Load a saved scenario back into the New editor for tweaking / regeneration.
  async function loadScenarioIntoEditor(s){
    if(s.type && state.types.some(t=>t.id===s.type)){ state.type=s.type; const f=$('format'); if(f) f.value=s.type; applyTypeDefaults(); }
    const setSel=(id,val)=>{ const el=$(id); if(el&&val!=null&&[...el.options].some(o=>o.value===String(val))) el.value=String(val); };
    if(s.vertical&&s.vertical.id) setSel('vertical', s.vertical.id);
    setSel('taboo', s.taboo); setSel('scenes', s.scenesRange); setSel('emotion', s.emotion);
    if($('ingredients')) $('ingredients').value=s.ingredients||'';
    if($('notes')) $('notes').value=s.notes||'';
    if(s.title){ $('title').value=String(s.title).replace(/\s·\sstep\s\d+$/,''); $('title').dataset.dirty='1'; }
    const cfg=curCfg();
    if((cfg.characters||0)>0 && Array.isArray(s.roles)&&s.roles.length){ state.roles=s.roles.map((r,i)=>({id:r.id||('r'+i),name:r.name||'',gender:r.gender||'any'})); }
    if((cfg.characters||0)===0) state.narratorGender=s.narratorGender||'any';
    if(s.voGender) state.voGender=s.voGender;
    if(s.voEnabled!=null) state.voEnabled=!!s.voEnabled;
    state.chosenHook=s.hook||'';
    renderCast();
    await loadSteps();
    const lastN=state.steps.length; const out=$('out'+lastN);
    if(out && Array.isArray(s.lines)){ out.value=s.lines.map(l=>l.text).join('\n'); out.dataset.clean=out.value; }
    const g=$('globalMsg'); if(g){ g.className='msg ok'; g.textContent=`loaded “${s.title||'scenario'}” — tweak params and ♻ Run / regenerate, or 💾 Save scenario.`; }
  }

  // ── Generic lab popup ──────────────────────────────────────────────────────
  function plPopup(title, bodyNode, footNode){
    const ov=document.createElement('div'); ov.className='pl-ov';
    ov.onmousedown=e=>{ if(e.target===ov) ov.remove(); };
    const box=document.createElement('div'); box.className='pl-box';
    const hd=document.createElement('div'); hd.className='pl-box-hd';
    const tt=document.createElement('span'); tt.style.flex='1'; tt.textContent=title;
    const x=document.createElement('button'); x.className='btn-sm'; x.textContent='✕'; x.onclick=()=>ov.remove();
    hd.append(tt, x);
    const bd=document.createElement('div'); bd.className='pl-box-bd'; bd.append(bodyNode);
    box.append(hd, bd); if(footNode){ footNode.style.cssText='display:flex;gap:10px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--line)'; box.append(footNode); }
    ov.append(box); (ROOT()||document.body).append(ov);
    return ov;
  }

  // ── Send to Edit: compute per-line routing (the kind transform), preview ──
  // ugc_ad / ugc_review (single on-camera) → every line is talking-head (on_camera);
  // voiceover → every line is the narrator voice (b-roll + subtitles are added later in Merge);
  // multi → routed by role tag (full multi support lands with the dialogue types).
  function computeRouting(s){
    const cfg=state.types.find(t=>t.id===s.type)||{};
    const isVoiceover = (cfg.characters===0) || s.mode==='voiceover';
    const isMulti = !!cfg.multi || s.mode==='multi';
    const out=[];
    // The hook is scene 1 of the script (lines[0]); it's routed like any other line below.
    (s.lines||[]).forEach(ln=>{
      if(isVoiceover){ out.push({ text:ln.text, kind:'vo', who:'narrator', gender:s.narratorGender||'any', media:['narrator voice'] }); return; }
      const role=(s.roles||[]).find(r=>r.id===ln.roleId) || (s.roles||[])[0] || {};
      out.push({ text:ln.text, kind:'on_camera', who:role.name||'Presenter', gender:role.gender||'any', media:['talking-head'] });
    });
    return out;
  }
  const KIND_BADGE={ on_camera:'<span class="badge ok">📷 on-camera</span>', vo:'<span class="badge">🔊 voiceover</span>' };
  function sendToEdit(s){
    const routed=computeRouting(s);
    if(!routed.length){ try{ alert('This scenario has no lines to send to Edit.'); }catch{} return; }
    const isVO=routed.every(r=>r.kind==='vo');
    // No routing-preview / casting step — the cast (character, photoshoot, voice) is
    // configured inside the Edit project's own Settings. Build directly + open it.
    buildEditProject(s, routed, { voice:null, obrazByRole:{} }, isVO);
  }

  // ── Casting confirm: pick a look per on-camera role / a narrator voice for vo ──
  function _obrazList(){ try{ return (typeof getObrazы==='function')?getObrazы():[]; }catch{ return []; } }
  function _gnormJs(g){ const s=String(g||'').toLowerCase(); return (s==='male'||s==='female')?s:'any'; }
  function _genderObrazy(g){ const all=_obrazList(); const ng=_gnormJs(g); const f=(ng==='any')?all:all.filter(o=>_gnormJs(o.gender)===ng); return f.length?f:all; }
  function _voiceDefaultId(g){ const list=window.ELEVENLABS_VOICES||[]; const ng=_gnormJs(g); const want=ng==='male'?'m':ng==='female'?'f':null; const m=(want?list.find(v=>v.gender===want):null)||list[0]; return m?m.id:''; }

  function openCastConfirm(s, routed){
    if(!routed || !routed.length){ const b=document.createElement('div'); b.className='msg'; b.textContent='This scenario has no lines to send to Edit.'; plPopup('⬈ Send to Edit', b); return; }
    const isVO = routed.every(r=>r.kind==='vo');
    const body=document.createElement('div');
    const picks={ voice:null, obrazByRole:{} };
    let roles=[], voiceSel=null, ok=null;
    const currentVoice=()=> voiceSel ? (voiceSel.value||'') : '';
    function updateOk(){ if(!ok) return; ok.disabled = isVO ? !currentVoice() : (roles.length===0 || Object.values(picks.obrazByRole).some(v=>!v)); }
    if(isVO){
      const g=_gnormJs(s.narratorGender);
      const lbl=document.createElement('div'); lbl.className='msg'; lbl.style.marginBottom='8px';
      lbl.textContent=`Faceless voiceover — pick a narrator voice${g!=='any'?' ('+g+')':''}. B-roll & subtitles are added later in Merge.`;
      body.append(lbl);
      voiceSel=document.createElement('select'); voiceSel.style.width='100%';
      const defId=()=>_voiceDefaultId(g);
      if(typeof window.registerVoiceSelect==='function'){ window.registerVoiceSelect(voiceSel, defId); }
      if(window.buildVoiceSelect){ window.buildVoiceSelect(voiceSel, defId()); }
      voiceSel.onchange=updateOk;
      body.append(voiceSel);
      const warn=document.createElement('div'); warn.className='msg'; warn.style.cssText='font-size:11px;margin-top:6px;color:var(--warn)';
      if(!(window.ELEVENLABS_VOICES||[]).length) warn.textContent='⚠ voice catalog still loading — the picker fills in shortly.';
      body.append(warn);
      // when the catalog arrives late, the select rebuilds (registerVoiceSelect) — clear the
      // warning and re-evaluate the button (a DOM rebuild doesn't fire onchange).
      const onVoices=()=>{ if(!document.contains(voiceSel)){ window.removeEventListener('el-voices-updated', onVoices); return; } warn.textContent=''; updateOk(); };
      window.addEventListener('el-voices-updated', onVoices);
    } else {
      const seen=new Set();
      routed.forEach(r=>{ if(r.kind!=='on_camera')return; const k=r.who+'|'+r.gender; if(seen.has(k))return; seen.add(k); roles.push(r); });
      if(roles.length>1){ const n=document.createElement('div'); n.className='msg'; n.style.cssText='margin-bottom:8px;color:var(--warn)'; n.textContent='Multiple roles — v1 casts ONE look to the whole session (first role).'; body.append(n); }
      roles.forEach((r,ri)=>{
        const row=document.createElement('div'); row.style.marginBottom='12px';
        const lbl=document.createElement('div'); lbl.className='msg'; lbl.style.marginBottom='4px'; lbl.textContent=`Role: ${r.who}${r.gender!=='any'?' ('+r.gender+')':''} — pick a look`;
        const sel=document.createElement('select'); sel.style.width='100%';
        const cand=_genderObrazy(r.gender);
        sel.innerHTML = cand.length ? cand.map(o=>`<option value="${o.id}">${esc(o.name||String(o.id))}${_gnormJs(o.gender)==='male'?' ♂':_gnormJs(o.gender)==='female'?' ♀':''}</option>`).join('') : '<option value="">(no looks yet — create one in Project Looks)</option>';
        picks.obrazByRole[ri]=sel.value||null;
        sel.onchange=()=>{ picks.obrazByRole[ri]=sel.value; updateOk(); };
        row.append(lbl, sel);
        const ng=_gnormJs(r.gender);
        if(ng!=='any' && !_obrazList().some(o=>_gnormJs(o.gender)===ng)){ const w=document.createElement('div'); w.className='msg'; w.style.cssText='font-size:11px;margin-top:4px;color:var(--warn)'; w.textContent='⚠ no look matches this gender — showing all looks.'; row.append(w); }
        body.append(row);
      });
    }
    const foot=document.createElement('div');
    ok=document.createElement('button'); ok.className='btn-sm primary'; ok.textContent='Build project';
    ok.onclick=()=>{ if(isVO) picks.voice=currentVoice(); buildEditProject(s, routed, picks, isVO); };
    foot.append(ok);
    plPopup('⬈ Build Edit project — cast', body, foot);
    updateOk();
  }

  // ── Build an Edit² session from the routed scenario (mirrors the legacy CREATE) ──
  function buildEditProject(s, routed, picks, isVO){
    const FZ = (typeof editFrozenSessions!=='undefined')?editFrozenSessions:(window.editFrozenSessions||{});
    const now=Date.now();
    const scenFile=`sv2_${s.id}`;                 // synthetic slug — cells are pre-injected, never fetched
    const nums=Object.values(FZ).filter(x=>(x.scenFile||'')===scenFile).map(x=>x.num||0);
    const num=nums.length?Math.max.apply(null,nums)+1:1;
    const d=new Date(now);
    const dd=String(d.getDate()).padStart(2,'0'), mm=String(d.getMonth()+1).padStart(2,'0'), yy=d.getFullYear(), hh=String(d.getHours()).padStart(2,'0'), mn=String(d.getMinutes()).padStart(2,'0');
    const scenName=String(s.title||'scenario').replace(/\s·\sstep\s\d+$/,'');
    const stamp=`${dd}.${mm}.${yy} ${hh}:${mn}`;
    const roleLabel = isVO ? 'Narrator' : (((routed.find(r=>r.kind==='on_camera')||{}).who) || 'Presenter');
    let key;
    if(isVO){
      const vid = picks.voice || _voiceDefaultId(_gnormJs(s.narratorGender));
      if(!vid){ try{ alert('Voice catalog has not loaded yet — reopen “Build Edit project” in a moment.'); }catch{} return; }
      const vobj = (typeof window.findVoiceByValue==='function') ? window.findVoiceByValue(vid) : null;
      const vlabel = (vobj&&vobj.name) ? String(vobj.name).split(' — ')[0] : 'Voiceover';
      key=`__vo____${scenFile}__${now}`;
      FZ[key]={ pending:false, num, title:`${stamp} — ${scenName} — VO: ${vlabel}`,
        itemsMode:'noitems', assignments:{}, obrazId:'__vo__', scenFile, obrazChar:null, roleLabel,
        templateSessionKey:null, date:d.toISOString(), voiceKind:'vo', narratorGender:_gnormJs(s.narratorGender),
        cells: routed.map(r=>({ line:r.text, detInfo:null, charImagePath:null, imagePath:null, audioPath:null, segKind:'vo' })) };
      try{ localStorage.setItem('edit_voice__'+key, vid); }catch{}
    } else {
      const obrazId=(picks.obrazByRole&&picks.obrazByRole[0])||'';
      const obraz=_obrazList().find(o=>String(o.id)===String(obrazId))||null;
      const vars = obraz ? [obraz.char].concat((obraz.variations||[]).filter(v=>v&&v!=='error')).filter(Boolean) : [];
      const pickVar=()=> vars.length?vars[Math.floor(Math.random()*vars.length)]:((obraz&&obraz.char)||null);
      const oname=(obraz&&obraz.name)||String(obrazId);
      key=`${obrazId}__${scenFile}__${now}`;
      FZ[key]={ pending:false, num, title:`${stamp} — ${scenName} — ${oname}`,
        itemsMode:'noitems', assignments:{}, obrazId:String(obrazId), scenFile, obrazChar:(obraz&&obraz.char)||null, roleLabel,
        templateSessionKey:null, date:d.toISOString(),
        cells: routed.map(r=>({ line:r.text, detInfo:null, charImagePath:pickVar(), imagePath:null, audioPath:null, segKind:'on_camera' })) };
      // voice resolves from obraz.voice automatically (E.resolveVoice → _obrazVoice)
    }
    // close the Scenarios popups
    try{ (ROOT()?[...ROOT().querySelectorAll('.pl-ov')]:[]).forEach(o=>o.remove()); }catch{}
    try{ localStorage.setItem('combo_selected_panel','edit'); }catch{}
    if (window.EDIT2Popup && EDIT2Popup.open) {
      // Shared shell: persist via the normal path (deps present), switch to Edit, open.
      if(typeof saveEditState==='function') saveEditState();
      try{ document.querySelectorAll('.combo-mode-btn').forEach(b=>b.classList.toggle('active', b.dataset.combo==='edit')); }catch{}
      try{ if(typeof showComboPanel==='function') showComboPanel('edit', true); }catch{}
      setTimeout(()=>{ try{ EDIT2Popup.open(key); }catch{} }, 300);
    } else {
      // Standalone Scenarios page (no Edit scripts here, so saveEditState's scen-*
      // deps are absent): persist just THIS session to the server directly (key-level
      // merge → no clobber), then open the Edit page with ?open=<key> so it auto-opens
      // once that page's grid hydrates.
      const go = () => { window.location.href = '/edit?open=' + encodeURIComponent(key); };
      fetch('/api/edit-state', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sessions: { [key]: FZ[key] } }) }).then(go, go);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // WIRING
  // ════════════════════════════════════════════════════════════════════════
  function _wire(){
    $('plTabSaved').onclick=openSavedPopup;   // New is the always-on editor; Saved opens a popup

    ['taboo','vertical','scenes','emotion','ingredients','notes'].forEach(bindGuarded);
    $('title').addEventListener('input',()=>{ $('title').dataset.dirty='1'; });
    $('theme').addEventListener('change',e=>{ state.theme=e.target.value; loadConfig(); });
    $('format').addEventListener('change',e=>selectType(e.target.value));
    $('reload').onclick=loadSteps;
    $('runAll').onclick=()=>runAll($('runAll'));

    // Library editor
    $('libClose').onclick=()=>$('libModal').classList.remove('open');
    $('libModal').addEventListener('mousedown',e=>{ if(e.target.id==='libModal') $('libModal').classList.remove('open'); });
    $('libSave').onclick=async()=>{
      const lines=$('libText').value.split('\n').map(l=>l.trim()).filter(Boolean);
      const isHooks=_libKind==='hooks';
      const url=isHooks?`${API}/hooks/set`:`${API}/comparisons/set`;
      const body=isHooks?{theme:state.theme,vertical:_libVid,hooks:lines}:{theme:state.theme,vertical:_libVid,lines};
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
      const m=$('libMsg'); m.className='msg '+(r.success?'ok':'err'); m.textContent=r.success?('saved ✓ ('+(r.count!=null?r.count:lines.length)+' lines)'):'save failed';
    };

    // Option editor (verticals / emotions)
    $('optHooksBtn').onclick=()=>{ const id=$('optLabel').dataset.id; if(!id){ optMsg('Pick or save a vertical first.','err'); return; } openLib('hooks', id, $('optLabel').value); };
    $('optCompBtn').onclick=()=>{ const id=$('optLabel').dataset.id; if(!id){ optMsg('Pick or save a vertical first.','err'); return; } openLib('comparisons', id, $('optLabel').value); };
    $('vertGear').onclick=()=>openOptEditor('verticals');
    $('emoGear').onclick=()=>openOptEditor('emotions');
    $('optClose').onclick=()=>$('optModal').classList.remove('open');
    $('optModal').addEventListener('mousedown',e=>{ if(e.target.id==='optModal') $('optModal').classList.remove('open'); });
    $('optList').onchange=e=>loadOpt(e.target.value);
    $('optNew').onclick=()=>{ $('optLabel').value=''; $('optDesc').value=''; $('optLabel').dataset.id=''; $('optLabel').focus(); optMsg('New — type a label and Save.'); };
    $('optSave').onclick=async()=>{
      const label=$('optLabel').value.trim(); if(!label){ optMsg('Label required.','err'); return; }
      const id=$('optLabel').dataset.id||'';
      optMsg('saving…','run');
      const r=await fetch(`${API}/options`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:state.theme,kind:_optKind,id,label,desc:$('optDesc').value})}).then(x=>x.json());
      if(!r.success){ optMsg('✗ '+(r.error||'failed'),'err'); return; }
      _opts=r.options||_opts; refreshOptDropdown(); renderOptList(r.option&&r.option.id); optMsg('saved ✓','ok'); loadSteps();
    };
    $('optDel').onclick=async()=>{
      const id=$('optLabel').dataset.id; if(!id){ optMsg('Nothing selected.','err'); return; }
      if(!confirm('Delete this item?')) return;
      const r=await fetch(`${API}/options?theme=${encodeURIComponent(state.theme)}&kind=${_optKind}&id=${encodeURIComponent(id)}`,{method:'DELETE'}).then(x=>x.json());
      if(!r.success){ optMsg('✗ delete failed','err'); return; }
      _opts=r.options||[]; refreshOptDropdown(); renderOptList(); loadOpt(''); optMsg('deleted ✓','ok'); loadSteps();
    };

    // Taboo editor
    $('tabooGear').onclick=openTabEditor;
    $('tabClose').onclick=()=>$('tabModal').classList.remove('open');
    $('tabModal').addEventListener('mousedown',e=>{ if(e.target.id==='tabModal') $('tabModal').classList.remove('open'); });
    $('tabList').onchange=e=>loadTab(e.target.value);
    $('tabText').addEventListener('input',renderTabPrev);
    $('tabSave').onclick=async()=>{
      const key=$('tabText').dataset.key; if(!key){ tabMsg('Pick a level.','err'); return; }
      tabMsg('saving…','run');
      const r=await fetch(`${API}/taboo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:state.theme,level:key,text:$('tabText').value})}).then(x=>x.json());
      if(!r.success){ tabMsg('✗ failed','err'); return; }
      _tabs=r.levels||_tabs; tabMsg('saved ✓','ok'); loadSteps();
    };

    // Scene-count editor
    $('scenesGear').onclick=openScnEditor;
    $('scnClose').onclick=()=>$('scnModal').classList.remove('open');
    $('scnModal').addEventListener('mousedown',e=>{ if(e.target.id==='scnModal') $('scnModal').classList.remove('open'); });
    $('scnAdd').onclick=()=>addScnRow('', false);
    $('scnSave').onclick=async()=>{
      const ranges=[]; let def='';
      [...$('scnRows').children].forEach(row=>{
        const val=(row.querySelector('.scnInp').value||'').trim();
        if(!/\d+\s*-\s*\d+/.test(val)) return;
        ranges.push(val);
        if(row.querySelector('input[type=radio]').checked) def=val;
      });
      if(!ranges.length){ scnMsg('Add at least one valid range like 12-16.','err'); return; }
      if(!def) def=ranges[0];
      scnMsg('saving…','run');
      const r=await fetch(`${API}/type`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:state.theme,type:state.type,sceneRanges:ranges,defaultSceneRange:def})}).then(x=>x.json());
      if(!r.success){ scnMsg('✗ '+(r.error||'failed'),'err'); return; }
      const ct=curCfg(); if(ct){ ct.sceneRanges=ranges; ct.defaultSceneRange=def; }
      $('scenes').innerHTML=ranges.map(x=>`<option value="${x}"${x===def?' selected':''}>${x}</option>`).join('');
      scnMsg('saved ✓','ok'); loadSteps();
    };
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  let _configLoaded=false;
  async function activate(){
    if(!_built){ _injectCSS(); _build(); _built=true; }
    if(!_configLoaded){ _configLoaded=true; try{ await loadConfig(); }catch(e){ console.error('[scen v2] config load failed', e); } }
  }

  window.ScenariosV2 = { activate };
})();
