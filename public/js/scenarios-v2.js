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
  background:var(--bg); color:var(--ink); font:12px/1.5 system-ui, Segoe UI, Roboto,Tahoma,Arial,sans-serif; }
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
/* 2-column New layout: params (left) | scenario (right) */
#l1-scenarii-v2 .pl-2col{display:grid;grid-template-columns:minmax(320px,400px) 1fr;gap:14px;align-items:start}
#l1-scenarii-v2 .pl-2col .card{margin-bottom:0}
#l1-scenarii-v2 .card h2 .mini-gear{margin-left:6px;vertical-align:middle}
#l1-scenarii-v2 .pl-right textarea.out{height:auto;min-height:360px}
#l1-scenarii-v2 #hookSelect{height:40px!important;min-height:40px!important;padding:9px 8px!important;line-height:1.3!important}
/* recent-values dropdown for free-text fields */
#l1-scenarii-v2 .histbox{position:absolute;left:0;right:0;background:#fff;border:2px solid;border-color:#808080 #fff #fff #808080;max-height:190px;overflow:auto;z-index:60;box-shadow:2px 2px 7px rgba(0,0,0,.35)}
#l1-scenarii-v2 .histbox .hh{padding:3px 8px;font-size:9.5px;color:#666;background:#ececec;border-bottom:1px solid #ccc}
#l1-scenarii-v2 .histrow{padding:5px 8px;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #ececec}
#l1-scenarii-v2 .histrow:hover{background:#000080;color:#fff}
/* prompt popup blocks */
#l1-scenarii-v2 #promptModal .modal{width:880px}
#l1-scenarii-v2 #promptSteps .prompt-block{margin-bottom:16px}
#l1-scenarii-v2 #promptSteps .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#444;display:flex;align-items:center;gap:8px;margin-bottom:6px}
#l1-scenarii-v2 #promptSteps .lbl .sp{margin-left:auto;display:flex;gap:6px}
#l1-scenarii-v2 #promptSteps .sys{height:300px;overflow:auto;white-space:pre-wrap;font-size:12px;background:#fff;border:2px solid;border-color:#808080 #fff #fff #808080;padding:10px 12px;color:#000;line-height:1.5;font-family:inherit}
#l1-scenarii-v2 #promptSteps .sys:focus{outline:none;border-color:#000080}
#l1-scenarii-v2 #promptSteps .sys mark.sub{background:#fff3b0;color:#7a4a00;font-weight:700}
#l1-scenarii-v2 #promptSteps .sys mark.sub2{background:#c8f0d8;color:#0a5a30;font-weight:700}
#l1-scenarii-v2 #promptSteps .sys mark.diff{background:#c8f0d8;color:#0a5a30;font-weight:600}
@media(max-width:980px){#l1-scenarii-v2 .step .bd{grid-template-columns:1fr}#l1-scenarii-v2 .ed{grid-template-columns:1fr}#l1-scenarii-v2 .pl-2col{grid-template-columns:1fr}}
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
    <label class="pl-inl" id="model-wrap"><span>Model</span>
      <select id="model" title="Model" style="min-width:140px">
        <option value="nousresearch/hermes-4-70b">Hermes 4 70B</option>
        <option value="nousresearch/hermes-4-405b" selected>Hermes 4 405B</option>
        <option value="nousresearch/hermes-3-llama-3.1-70b">Hermes 3 70B</option>
      </select>
    </label>
    <label class="pl-inl" id="dlg-proj-wrap" style="display:none"><span>Project</span>
      <select id="dlg-project" title="Dialogue projects" style="min-width:200px"><option value="">&mdash; projects &mdash;</option></select>
      <button class="btn-sm" id="dlg-proj-del" type="button" title="Delete this project" style="margin-left:4px">del</button>
    </label>
    <span class="pl-tabs-sp"></span>
    <button class="pl-tab" id="plTabSaved">💾 Saved</button>
  </div>

  <div id="pl-new"><div class="wrap">
    <div class="pl-2col">

      <!-- LEFT: generation parameters -->
      <div class="card pl-left">
        <h2>Generation parameters <button class="mini-gear" id="promptGear" title="View the full prompt (with your parameters injected)">⚙</button></h2>
        <label class="fld"><span>Title</span><input type="text" id="title" placeholder="auto…"></label>
        <label class="fld" style="margin-top:10px"><span class="lblrow">Ingredients / props (the fake-recipe core) <span class="tip" id="ingTip" data-tip="">ⓘ</span></span><input type="text" id="ingredients" placeholder="e.g. baking soda, garlic, olive oil"></label>
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
        </div>
        <div class="row" style="margin-top:10px">
          <label class="fld"><span class="lblrow">Scenes <button class="mini-gear" id="scenesGear" title="Edit scene counts">⚙</button></span><select id="scenes"></select></label>
          <label class="fld"><span class="lblrow">Emotion <button class="mini-gear" id="emoGear" title="Edit emotions">⚙</button></span><select id="emotion"></select></label>
        </div>
        <label class="fld" style="margin-top:10px"><span>Cast &amp; gender <span class="hint">(pick gender; “any” lets the model choose)</span></span>
          <div id="castRows" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"></div>
        </label>
        <label class="fld" style="margin-top:10px"><span>Notes (freeform — hard requirements)</span><textarea id="notes" style="height:54px" placeholder="e.g. 30-day deadline · add a skeptical wife · avoid mentioning price · mention a specific city"></textarea></label>
        <div class="bar" style="margin-top:14px">
          <button class="primary" id="runAll">▶ Run</button>
          <button id="reload">↻ Reload</button>
          <span id="runMsgHost"></span>
        </div>
        <div class="msg" id="globalMsg"></div>
        <div class="notice" id="noSteps"></div>
      </div>

      <!-- RIGHT: scenario -->
      <div class="card pl-right">
        <h2>Scenario</h2>
        <div class="result-head">
          <span class="lbl" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)">Result <span id="cntHost"></span></span>
          <span class="hookpick" title="Hook (scene 1) — pick one of 4">🪝
            <select id="hookSelect"><option value="">— run to generate hooks —</option></select>
            <button class="btn-sm" id="hookGen" title="Regenerate 4 hooks" style="display:none">♻</button>
            <button class="btn-sm" id="hookStar" title="Save the selected hook to the vertical base" style="display:none">⭐</button>
          </span>
        </div>
        <div class="msg" id="hookMsg"></div>
        <div id="resultHost"></div>
        <div class="savescen-bar"><button class="btn-sm primary" id="saveScenBtn">💾 Save scenario</button></div>
        <div class="embed-bar" style="margin-top:10px;border-top:1px solid #b0aca4;padding-top:8px">
          <div class="lbl" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin-bottom:6px">💡 Weave a thought into the script (Hermes 4)</div>
          <textarea id="sv2-embed-thought" style="min-height:46px;height:80px;width:100%;box-sizing:border-box" placeholder="Thought to weave in, e.g.: “Pharma bans this info — it'll be taken down soon.” The AI works it subtly into the narrative."></textarea>
          <div class="bar" style="padding:6px 0 0"><button class="btn-sm primary" id="sv2-embed-btn">✨ Weave in</button><button class="btn-sm" id="sv2-embed-undo" style="display:none">↶ Undo</button><span class="msg" id="sv2-embed-msg"></span></div>
        </div>
      </div>

    </div>
    <!-- hidden chaining outputs for multi-step formats -->
    <div id="hiddenOuts" style="display:none"></div>
  </div></div>

  <!-- DIALOGUES mode (format=dialogues): 4 quarters by width -->
  <div id="pl-dialogues" style="display:none"><div class="wrap">
    <div style="display:flex;gap:14px" id="dlg-cols">
      <div class="card dlg-col" id="dlg-models"></div>
      <div class="card dlg-col" id="dlg-script"></div>
      <div class="card dlg-col" id="dlg-work"><div class="dlg-head"><span class="dlg-title">Script &amp; work</span></div><div class="dlg-body"><div class="notice">scenario + further work — coming next</div></div></div>
    </div>
  </div></div>

  <!-- Full-prompt viewer (params injected into the system prompt) -->
  <div class="modal-bg" id="promptModal">
    <div class="modal">
      <h3>📄 Full prompt — your parameters injected into the system prompt</h3>
      <p class="msub">Exactly what is sent to the model (editable; <b style="color:#7a4a00">params</b> · <b style="color:#0a5a30">vertical library</b>). Save to persist edits to the step file.</p>
      <div id="promptSteps"></div>
      <div class="foot"><button id="promptClose">Close</button></div>
    </div>
  </div>

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

  // ── Field history: remember recent free-text values locally, suggest on focus ─
  const HIST_KEY='sv2_field_hist_v1';
  function _histLoad(){ try{ return JSON.parse(localStorage.getItem(HIST_KEY))||{}; }catch{ return {}; } }
  function _histSave(o){ try{ localStorage.setItem(HIST_KEY, JSON.stringify(o)); }catch{} }
  function pushHistory(key, value){
    value=String(value||'').trim(); if(!value) return;
    const all=_histLoad(); let arr=(all[key]||[]).filter(v=>v!==value);
    arr.unshift(value); all[key]=arr.slice(0,12); _histSave(all);
  }
  function attachHistory(el, key){
    if(!el || el.dataset.histBound) return; el.dataset.histBound='1';
    let box=null;
    const close=()=>{ if(box){ box.remove(); box=null; } };
    const open=()=>{
      close();
      const items=_histLoad()[key]||[]; if(!items.length) return;
      const lab=el.closest('label.fld')||el.parentElement; lab.style.position='relative';
      box=document.createElement('div'); box.className='histbox';
      const hd=document.createElement('div'); hd.className='hh'; hd.textContent='recent — click to fill'; box.appendChild(hd);
      items.forEach(v=>{ const row=document.createElement('div'); row.className='histrow'; row.textContent=v; row.title=v;
        row.onmousedown=(e)=>{ e.preventDefault(); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); close(); el.blur(); };
        box.appendChild(row); });
      box.style.top=(el.offsetTop+el.offsetHeight+2)+'px';
      lab.appendChild(box);
    };
    el.addEventListener('focus', open);
    el.addEventListener('blur', ()=>setTimeout(close,160));
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
    // Dialogues is a custom (non-spine) mode with its own layout — add it explicitly.
    { const od=document.createElement('option'); od.value='dialogues'; od.textContent='Dialogues'; fmt.appendChild(od); }
    if(state.type!=='dialogues' && (HIDDEN_TYPES.includes(state.type)||PAUSED_TYPES.includes(state.type)||!state.types.some(t=>t.id===state.type))){
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
    if(state.type==='dialogues') return;
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
  // Switch between scenario formats. 'dialogues' = custom layout (#pl-dialogues);
  // everything else = the standard ugc spine flow (#pl-new). Syncs the /scenarios/<id> URL.
  function setFormat(id, noPush){
    const dlg = (id === 'dialogues');
    const nw=$('pl-new'), pd=$('pl-dialogues');
    if(nw) nw.style.display = dlg ? 'none' : '';
    if(pd) pd.style.display = dlg ? '' : 'none';
    const mw=$('model-wrap'), pw=$('dlg-proj-wrap');   // header: model select (ugc) <-> projects (dialogues)
    if(mw) mw.style.display = dlg ? 'none' : '';
    if(pw) pw.style.display = dlg ? '' : 'none';
    const f=$('format'); if(f && f.value!==id) f.value=id;
    if(!noPush){ try{ history.pushState({}, '', '/scenarios/'+id); }catch(e){} }
    if(dlg){ state.type='dialogues'; initDialogues(); }
    else { selectType(id); }
  }
  let _dlgInited=false;
  // ── Q1: left model list (Males/Females/Other accordions; hover flyout with
  // photoshoots; click a photoshoot -> auto-activate + choose frame; max 2 active = L/R) ──
  let _dlgModels=[], dlgActive=[null, null], dlgFrame={};   // dlgActive = [hostId, guestId] (slots; null = empty)
  function _activeIds(){ return dlgActive.filter(Boolean); }
  function _dlgModelImg(o){ return o._portrait || o.portrait || o.baseFace || o.char || ''; }   /* portrait only, never tpose */
  function _dlgRowFind(id){ const h=$('dlg-models'); return h ? Array.prototype.find.call(h.querySelectorAll('.dlg-row'), r=>String(r.dataset.id)===String(id)) : null; }
  function initDialogues(){ if(_dlgInited) return; _dlgInited=true; _injectDlgCSS(); buildModelsPanel(); buildScriptPanel(); buildWorkPanel();
    const dd=$('dlg-project'); if(dd&&!dd._wired){ dd._wired=true; dd.addEventListener('change',()=>{ if(dd.value) loadProject(dd.value); }); }
    const del=$('dlg-proj-del'); if(del&&!del._wired){ del._wired=true; del.addEventListener('click',()=>{ const id=($('dlg-project')||{}).value||_dlgCurProject; if(id) deleteProject(id); }); }
    loadProjectsList();
  }
  function _dlgHead(title){ return `<div class="dlg-head"><span class="dlg-title">${title}</span><button class="dlg-collapse" type="button" title="Collapse">◂</button></div>`; }
  function _wireCollapse(host){ const btn=host&&host.querySelector('.dlg-collapse'); if(!btn) return; btn.addEventListener('click',e=>{ e.stopPropagation(); const c=host.classList.toggle('dlg-collapsed'); btn.textContent=c?'▸':'◂'; }); host.addEventListener('click',()=>{ if(host.classList.contains('dlg-collapsed')){ host.classList.remove('dlg-collapsed'); btn.textContent='◂'; } }); }
  // ── Q2: dialogue generator (two-pass: Gemini clean -> Hermes recolor) ─────────
  const DLG_THEME='marketing';
  let dlgClean=[], dlgColored=[], dlgView='colored', dlgViewMode='pairs';   // dlgViewMode: 'pairs' (2/row) | 'rows' (1/row)
  let dlgRoleName={host:'Host', guest:'Guest'};   // editable role names from the cast pills -> generation
  function buildScriptPanel(){
    const host=$('dlg-script'); if(!host) return;
    host.innerHTML = `
      <div class="dlg-head"><span class="dlg-title">Dialogue</span><button class="dlg-collapse" type="button" title="Collapse">◂</button></div>
      <div class="dlg-body">
      <label class="fld"><span>topic / offer</span>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="dlg-topic" type="text" placeholder="offer / what the dialogue sells" style="flex:1;min-width:0">
          <label class="ios" title="Include the offer in the script"><input type="checkbox" id="dlg-include" checked><span class="sl"></span></label>
        </div>
      </label>
      <div class="row" style="margin-top:8px">
        <label class="fld"><span>Vertical</span><select id="dlg-vertical"></select></label>
        <label class="fld"><span class="lblrow">Source <button class="mini-gear" id="dlg-srcGear" title="Manage sources">+</button></span><select id="dlg-source"></select></label>
      </div>
      <div class="row" style="margin-top:8px">
        <label class="fld"><span>Tone</span><select id="dlg-tone"><option value="">auto</option><option value="casual">casual</option><option value="expert">expert</option><option value="energetic">energetic</option><option value="debate">debate</option><option value="comedic">comedic</option><option value="heart-to-heart">heart-to-heart</option></select></label>
        <label class="fld"><span>Taboo</span><select id="dlg-taboo"><option value="none">none</option><option value="mild">mild</option><option value="spicy" selected>spicy</option><option value="explicit">explicit</option></select></label>
      </div>
      <div class="row" style="margin-top:8px;align-items:flex-end">
        <label class="fld" style="flex:0 0 80px;min-width:0"><span>Lines</span><input id="dlg-lines" type="number" min="2" max="14" value="6"></label>
        <button class="primary" id="dlg-gen" style="margin-left:auto">▶ Generate</button>
      </div>
      <div class="notice" id="dlg-runlog" style="display:none"></div>
      <div class="msg" id="dlg-status"></div>
      <div class="dlg-cast" id="dlg-cast"></div>
      </div>`;
    fetch(`${API}/verticals?theme=${DLG_THEME}`).then(x=>x.json()).then(d=>{
      const sel=$('dlg-vertical'); sel.innerHTML=(d.verticals||[]).map(v=>`<option value="${v.id||v.label}">${v.label||v.id}</option>`).join('')||'<option value="">(none)</option>';
      loadDlgSources();
    }).catch(()=>{});
    $('dlg-vertical').addEventListener('change', loadDlgSources);
    $('dlg-gen').addEventListener('click', onGenClick);
    $('dlg-srcGear').addEventListener('click', openDlgSrcMgr);
    _wireCollapse($('dlg-script'));
    renderCastPills();
  }
  // role pills (one per line): [thumb][Host/Guest][editable role name]. Appear when the
  // corresponding model is selected; the role name feeds the generation prompt.
  function renderCastPills(){
    const box=$('dlg-cast'); if(!box) return;
    const html=[['host','Host'],['guest','Guest']].map(([sp,def])=>{
      const rm=_dlgRoleModel(sp); if(!rm) return '';
      const val=(dlgRoleName[sp]||def).replace(/"/g,'&quot;');
      return `<div class="dlg-castpill" data-role="${sp}"><img class="dlg-castpill-th" src="${rm.frame}" alt=""><span class="dlg-castpill-tag">${def}</span><input class="dlg-castpill-role" type="text" data-role="${sp}" value="${val}" placeholder="${def} role (e.g. doctor)"></div>`;
    }).join('');
    box.innerHTML = html || '<div class="notice" style="padding:6px 8px">Pick characters in Models to set up Host &amp; Guest.</div>';
    box.querySelectorAll('.dlg-castpill-role').forEach(inp=>inp.addEventListener('input',()=>{ dlgRoleName[inp.dataset.role]=inp.value; }));
    _updateGenGate();
  }
  function _updateGenGate(){ const b=$('dlg-gen'); if(!b||_dlgGenState!=='idle') return; const ok=!!(dlgActive[0]&&dlgActive[1]); b.disabled=!ok; b.title=ok?'':'Pick a Host and a Guest character first'; }
  // ── dialogue projects (header dropdown) ───────────────────────────────────────
  const DLG_API_PROJ='/api/dialogue/projects';
  let _dlgCurProject=null;
  async function loadProjectsList(sel){
    const dd=$('dlg-project'); if(!dd) return;
    try{ const d=await fetch(DLG_API_PROJ).then(x=>x.json()); const cur=(sel!==undefined)?sel:dd.value;
      dd.innerHTML='<option value="">— projects —</option>'+(d.projects||[]).map(p=>`<option value="${p.id}">${String(p.name||p.id).replace(/</g,'&lt;')}</option>`).join('');
      if(cur) dd.value=cur;
    }catch(e){}
  }
  function _dlgSnapshot(){
    return { product:$('dlg-topic').value, includeProduct:$('dlg-include').checked, vertical:$('dlg-vertical').value, source:$('dlg-source').value, tone:$('dlg-tone').value, taboo:$('dlg-taboo').value, lines:$('dlg-lines').value,
      viewMode:dlgViewMode, view:dlgView, roles:{host:dlgRoleName.host,guest:dlgRoleName.guest},
      cast:{ host:dlgActive[0]?{id:dlgActive[0],frame:dlgFrame[dlgActive[0]]||''}:null, guest:dlgActive[1]?{id:dlgActive[1],frame:dlgFrame[dlgActive[1]]||''}:null },
      clean:dlgClean, colored:dlgColored };
  }
  async function saveCurrentProject(){
    const data=_dlgSnapshot(); const prod=String(data.product||'').trim();
    let date=''; try{ date=new Date().toISOString().slice(0,10); }catch(e){}
    const name=(date?date+' - ':'')+(prod?prod.slice(0,42):'dialogue');
    try{ const r=await fetch(DLG_API_PROJ+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})}).then(x=>x.json());
      if(r&&r.project){ _dlgCurProject=r.project.id; await loadProjectsList(r.project.id); } }catch(e){}
  }
  async function loadProject(id){
    if(!id) return;
    try{ const r=await fetch(DLG_API_PROJ+'/get?id='+encodeURIComponent(id)).then(x=>x.json()); const p=r&&r.project; if(!p) return; const d=p.data||{};
      _dlgCurProject=id;
      $('dlg-topic').value=d.product||''; $('dlg-include').checked=d.includeProduct!==false;
      $('dlg-tone').value=d.tone||''; $('dlg-taboo').value=d.taboo||'spicy'; $('dlg-lines').value=d.lines||6;
      if(d.vertical){ $('dlg-vertical').value=d.vertical; await loadDlgSources(); if(d.source) $('dlg-source').value=d.source; }
      dlgRoleName={ host:(d.roles&&d.roles.host)||'Host', guest:(d.roles&&d.roles.guest)||'Guest' };
      dlgActive=[ d.cast&&d.cast.host?String(d.cast.host.id):null, d.cast&&d.cast.guest?String(d.cast.guest.id):null ];
      if(d.cast&&d.cast.host&&d.cast.host.frame) dlgFrame[String(d.cast.host.id)]=d.cast.host.frame;
      if(d.cast&&d.cast.guest&&d.cast.guest.frame) dlgFrame[String(d.cast.guest.id)]=d.cast.guest.frame;
      dlgClean=Array.isArray(d.clean)?d.clean:[]; dlgColored=Array.isArray(d.colored)?d.colored:dlgClean;
      dlgViewMode=(d.viewMode==='rows')?'rows':'pairs'; dlgView=(d.view==='clean')?'clean':'colored';
      const vt=$('dlg-view-tog'); if(vt) vt.checked=(dlgViewMode==='rows'); const cc=$('dlg-cc-tog'); if(cc) cc.checked=(dlgView==='colored');
      renderActive(); renderDlgScenario();
    }catch(e){}
  }
  async function deleteProject(id){ if(!id) return; try{ await fetch(DLG_API_PROJ+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); }catch(e){} if(_dlgCurProject===id) _dlgCurProject=null; await loadProjectsList(''); }
  // regen guard: a project is loaded -> ask delete-loaded vs keep-and-new vs cancel
  function _dlgConfirmRegen(){
    return new Promise(resolve=>{
      let ov=document.getElementById('dlgRegenConfirm'); if(ov) ov.remove();
      ov=document.createElement('div'); ov.id='dlgRegenConfirm'; ov.className='dlg-modal-ov';
      ov.innerHTML='<div class="dlg-modal"><div class="dlg-modal-h">A project is loaded</div><div class="dlg-modal-b">Generating creates a NEW project. What about the loaded one?</div><div class="dlg-modal-f"><button class="primary" id="drc-keep" type="button">Save it &amp; generate new</button><button id="drc-del" type="button">Delete loaded &amp; generate</button><button id="drc-cancel" type="button">Cancel</button></div></div>';
      (document.getElementById('l1-scenarii-v2')||document.body).appendChild(ov);
      const done=v=>{ try{ ov.remove(); }catch(e){} resolve(v); };
      ov.querySelector('#drc-keep').onclick=()=>done('keep');
      ov.querySelector('#drc-del').onclick=()=>done('delete');
      ov.querySelector('#drc-cancel').onclick=()=>done(null);
      ov.addEventListener('mousedown',e=>{ if(e.target===ov) done(null); });
    });
  }
  async function loadDlgSources(){
    const sel=$('dlg-source'); if(!sel) return; const prev=sel.value;
    sel.innerHTML='<option value="all">All sources</option>';
    const vid=$('dlg-vertical').value; if(!vid) return;
    try{ const d=await fetch(`${API}/sources?theme=${DLG_THEME}&vertical=${encodeURIComponent(vid)}`).then(x=>x.json()); (d.sources||[]).forEach(s=>{ const o=document.createElement('option'); o.value=s.key; o.textContent=`${s.key} (${s.chars})`; sel.appendChild(o); }); }catch(e){}
    if(prev && Array.prototype.some.call(sel.options,o=>o.value===prev)) sel.value=prev;
  }
  // playful loader captions per stage (1..4), shown under the spinner in the work zone
  const DLG_LOADER_PHRASES = [
    ['Sketching the hook...', 'Casting the two voices', 'Hunting the opening line', 'Stacking the selling beats', 'Warming up the copywriter', 'Finding the angle that bites', 'Roughing out the banter'],
    ['Baking the taboo...', 'Cooking the chaos', 'Turning up the heat', 'Sharpening the hooks', 'Adding a little spice', 'Letting it get reckless', 'Making it hit harder'],
    ['Reading the room', 'Feeling out each line', 'Where to laugh, where to sigh', 'Mapping the mood', 'Tuning into the vibe', 'Sensing the subtext', 'Scoring the emotions'],
    ['Teaching lines to breathe', 'Whispering and shouting', 'Pinning emotions in brackets', 'Directing the delivery', 'Dropping the voice tags', 'Polishing the performance', 'Cueing every gasp'],
  ];
  let _dlgAbort=null, _dlgGenState='idle', _dlgPhraseT=null, _dlgGenStage=1, _dlgConfirmT=null;
  // Work zone: header (title + Clean/Colored iOS toggle) + body that shows the loader or the script.
  function buildWorkPanel(){
    const host=$('dlg-work'); if(!host) return;
    host.innerHTML = `
      <div class="dlg-head">
        <span class="dlg-title">Script &amp; work</span>
        <div class="dlg-head-tools">
          <button class="dlg-vall" id="dlg-voice-all" type="button" title="Voice every line">&#128266; Voice all</button>
          <label class="dlg-cc" title="Pairs (2 per row) / Rows (1 per row)"><span>Pairs</span><label class="ios"><input type="checkbox" id="dlg-view-tog"><span class="sl"></span></label><span>Rows</span></label>
          <label class="dlg-cc" title="Clean / taboo-Colored"><span>Clean</span><label class="ios"><input type="checkbox" id="dlg-cc-tog" checked><span class="sl"></span></label><span>Colored</span></label>
        </div>
      </div>
      <div class="dlg-body" id="dlg-work-body"><div class="notice">Generate a dialogue to see the script here.</div></div>`;
    const cc=$('dlg-cc-tog'); if(cc) cc.addEventListener('change',()=>{ dlgView=cc.checked?'colored':'clean'; renderDlgScenario(); });
    const vt=$('dlg-view-tog'); if(vt) vt.addEventListener('change',()=>{ dlgViewMode=vt.checked?'rows':'pairs'; renderDlgScenario(); });
    const va=$('dlg-voice-all'); if(va) va.addEventListener('click', _dlgVoiceAll);
  }
  function setDlgView(v){ dlgView=(v==='clean')?'clean':'colored'; const t=$('dlg-cc-tog'); if(t) t.checked=(dlgView==='colored'); renderDlgScenario(); }
  function _dlgWorkBody(html){ const b=$('dlg-work-body'); if(b) b.innerHTML=html; }
  function _dlgLoader(){ _dlgWorkBody(`<div class="dlg-loader"><div class="dlg-spinner"></div><div class="dlg-stage" id="dlg-stage">Starting...</div><div class="dlg-phrase" id="dlg-phrase"></div></div>`); }
  function _dlgTickPhrase(){ const p=$('dlg-phrase'); if(!p) return; const list=DLG_LOADER_PHRASES[Math.max(0,Math.min(3,_dlgGenStage-1))]||[]; if(list.length) p.textContent=list[Math.floor(Math.random()*list.length)]; }
  function _dlgSetStage(n,total,label){ _dlgGenStage=n; const s=$('dlg-stage'); if(s) s.textContent=`${n}/${total} - ${label}`; _dlgTickPhrase(); }
  function _dlgStartPhrases(){ _dlgStopPhrases(); _dlgTickPhrase(); _dlgPhraseT=setInterval(_dlgTickPhrase,1800); }
  function _dlgStopPhrases(){ if(_dlgPhraseT){ clearInterval(_dlgPhraseT); _dlgPhraseT=null; } }
  function _setGenBtn(state){ const b=$('dlg-gen'); _dlgGenState=state; if(_dlgConfirmT){ clearTimeout(_dlgConfirmT); _dlgConfirmT=null; } if(!b) return;
    if(state==='idle'){ b.textContent='▶ Generate'; b.classList.remove('danger'); b.disabled=false; _updateGenGate(); }
    else if(state==='gen'){ b.textContent='■ Stop'; b.classList.add('danger'); b.disabled=false; }
    else if(state==='confirm'){ b.textContent='Stop — really?'; b.disabled=false; _dlgConfirmT=setTimeout(()=>{ if(_dlgGenState==='confirm') _setGenBtn('gen'); },2500); }
  }
  async function onGenClick(){
    if(_dlgGenState==='idle'){
      if(!(dlgActive[0]&&dlgActive[1])){ const st=$('dlg-status'); if(st) st.textContent='Pick a Host and a Guest character first.'; return; }
      if(_dlgCurProject){ const ch=await _dlgConfirmRegen(); if(!ch) return; if(ch==='delete') await deleteProject(_dlgCurProject); _dlgCurProject=null; }
      genDialogue();
    }
    else if(_dlgGenState==='gen') _setGenBtn('confirm');
    else if(_dlgGenState==='confirm'){ if(_dlgAbort){ try{ _dlgAbort.abort(); }catch(e){} } }
  }
  function _dlgFmtTags(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\[([^\]]+)\]/g,'<span class="dlg-tag">[$1]</span>'); }
  function _dlgSpeakerHtml(speaker){
    const rm=_dlgRoleModel(speaker), role=speaker==='guest'?'Guest':'Host';
    const av = rm
      ? `<img class="dlg-av" src="${rm.frame}" data-role="${speaker}" title="${(rm.name||role)} - click to change">`
      : `<button class="dlg-av-add" type="button" data-role="${speaker}" title="Assign ${role}">+</button>`;
    return `<div class="dlg-card-spk">${av}<span class="dlg-card-who">${role}</span></div>`;
  }
  function renderDlgScenario(){
    const body=$('dlg-work-body'); if(!body) return;
    const lines=(dlgView==='clean')?dlgClean:dlgColored;
    if(!lines||!lines.length){ body.innerHTML='<div class="notice">Generate a dialogue to see the script here.</div>'; return; }
    const card=(l,idx)=> l ? `<div class="dlg-card ${l.speaker==='guest'?'guest':'host'}">
        <div class="dlg-card-h">${_dlgSpeakerHtml(l.speaker)}<button class="dlg-card-voice" type="button" data-idx="${idx}" title="Voice this line">&#128266;</button></div>
        <div class="dlg-card-tx" contenteditable="true" spellcheck="false" data-idx="${idx}">${_dlgFmtTags(l.text)}</div>
      </div>` : '';
    let html='<div class="dlg-scn '+(dlgViewMode==='rows'?'mode-rows':'mode-pairs')+'">';
    if(dlgViewMode==='rows'){ lines.forEach((l,i)=>{ html+='<div class="dlg-scn-row">'+card(l,i)+'</div>'; }); }
    else { for(let i=0;i<lines.length;i+=2){ html+='<div class="dlg-scn-row">'+card(lines[i],i)+card(lines[i+1],i+1)+'</div>'; } }
    html+='</div>';
    body.innerHTML=html;
    const arr=()=> (dlgView==='clean')?dlgClean:dlgColored;
    body.querySelectorAll('.dlg-card-tx').forEach(el=>{ el.addEventListener('input',()=>{ const a=arr(), i=+el.dataset.idx; if(a[i]) a[i].text=el.textContent; }); });
    body.querySelectorAll('.dlg-av-add,.dlg-av').forEach(b=>{ b.addEventListener('click',e=>{ e.stopPropagation(); openRolePicker(b.dataset.role,b); }); });
    body.querySelectorAll('.dlg-card-voice').forEach(b=>{ b.addEventListener('click',()=>_dlgVoiceLine(+b.dataset.idx)); });
  }
  // "+" / avatar click -> floating model picker; hover a model = photoshoots flyout, pick assigns the role
  function openRolePicker(speaker,anchor){
    let ov=document.getElementById('dlgRolePick'); if(ov) ov.remove();
    ov=document.createElement('div'); ov.id='dlgRolePick'; ov.className='dlg-pick';
    const byG=g=>_dlgModels.filter(o=>g==='other'?!(o.gender==='male'||o.gender==='female'):o.gender===g);
    let html=`<div class="dlg-pick-h">Assign ${speaker==='guest'?'Guest':'Host'}</div>`;
    [['male','Males'],['female','Females'],['other','Other']].forEach(([g,label])=>{ const items=byG(g); if(!items.length) return;
      html+=`<div class="dlg-pick-g">${label}</div>`;
      items.forEach(o=>{ html+=`<div class="dlg-pick-row" data-id="${o.id}"><img src="${_dlgModelImg(o)}"><span>${String(o.name||'model').replace(/</g,'&lt;')}</span></div>`; });
    });
    if(!_dlgModels.length) html+='<div class="notice" style="padding:6px 8px">No models.</div>';
    ov.innerHTML=html;
    (document.getElementById('l1-scenarii-v2')||document.body).appendChild(ov);
    const rb=anchor.getBoundingClientRect();
    ov.style.top=Math.max(8,Math.min(rb.bottom+4,(window.innerHeight||800)-340))+'px';
    ov.style.left=Math.max(8,Math.min(rb.left,(window.innerWidth||1200)-236))+'px';
    const close=()=>{ try{ ov.remove(); }catch(e){} document.removeEventListener('mousedown',onDoc,true); if(_fly) _fly.classList.remove('on'); };
    const onDoc=e=>{ if(!ov.contains(e.target) && !(_fly&&_fly.contains(e.target))) close(); };
    setTimeout(()=>document.addEventListener('mousedown',onDoc,true),0);
    ov.querySelectorAll('.dlg-pick-row').forEach(row=>{ const id=row.dataset.id;
      row.addEventListener('mouseenter',()=>showFlyout(id,row,{onPick:(frame)=>{ setRoleModel(speaker,id,frame); close(); }}));
      row.addEventListener('mouseleave',scheduleHideFlyout);
      row.addEventListener('click',()=>{ const m=_dlgModels.find(x=>String(x.id)===String(id)); setRoleModel(speaker,id, dlgFrame[id]||_dlgModelImg(m)); close(); });
    });
  }
  function _dlgVoiceLine(i){ const st=$('dlg-status'); if(st) st.textContent='Voiceover (ElevenLabs v3) is wired up in the next step.'; }
  function _dlgVoiceAll(){ const st=$('dlg-status'); if(st) st.textContent='Voiceover (ElevenLabs v3) is wired up in the next step.'; }
  function _dlgOnDone(ev){
    const norm=a=>(Array.isArray(a)?a:[]).map(l=>({speaker:l.speaker==='guest'?'guest':'host',text:String(l.text||'')}));
    dlgClean=norm(ev.clean); dlgColored=norm(ev.colored&&ev.colored.length?ev.colored:ev.clean);
    const rl=$('dlg-runlog'); if(rl){ rl.textContent=(ev.logs||[]).join('\n'); rl.style.display=(ev.logs||[]).length?'block':'none'; }
    renderDlgScenario();
    const st=$('dlg-status'); if(st) st.textContent='Done.';
    saveCurrentProject();   // each generation -> a new project (date + product)
  }
  async function genDialogue(){
    dlgClean=[]; dlgColored=[];
    _dlgAbort=new AbortController();
    _setGenBtn('gen');
    const st=$('dlg-status'); if(st) st.textContent='';
    const rl=$('dlg-runlog'); if(rl){ rl.style.display='none'; rl.textContent=''; }
    _dlgLoader(); _dlgStartPhrases();
    let buf='', got=false;
    try{
      const resp=await fetch('/api/dialogue/script',{method:'POST',headers:{'Content-Type':'application/json'},signal:_dlgAbort.signal,body:JSON.stringify({
        topic:$('dlg-topic').value, product:$('dlg-topic').value, includeProduct:$('dlg-include').checked,
        hostRole:(dlgRoleName.host||'Host'), guestRole:(dlgRoleName.guest||'Guest'), lines:$('dlg-lines').value,
        vertical:$('dlg-vertical').value, source:$('dlg-source').value, tone:$('dlg-tone').value, taboo:$('dlg-taboo').value, theme:DLG_THEME
      })});
      const reader=resp.body.getReader(), dec=new TextDecoder();
      while(true){ const {value,done}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true});
        let idx; while((idx=buf.indexOf('\n\n'))>=0){ const chunk=buf.slice(0,idx); buf=buf.slice(idx+2);
          const ln=chunk.replace(/^data: ?/,'').trim(); if(!ln) continue; let ev; try{ ev=JSON.parse(ln); }catch(e){ continue; }
          if(ev.type==='step') _dlgSetStage(ev.n,ev.total,ev.label);
          else if(ev.type==='done'){ got=true; _dlgOnDone(ev); }
          else if(ev.type==='error') throw new Error(ev.error||'generation failed');
        }
      }
      if(!got) throw new Error('stream ended early');
    }catch(e){
      if(e.name==='AbortError'){ _dlgWorkBody('<div class="notice">Generation cancelled.</div>'); if(st) st.textContent='Cancelled.'; }
      else { _dlgWorkBody('<div class="notice" style="color:var(--danger)">Error: '+(e.message||e)+'</div>'); if(st) st.textContent='Error: '+(e.message||e); }
    }finally{ _dlgStopPhrases(); _setGenBtn('idle'); _dlgAbort=null; }
  }
  function openDlgSrcMgr(){
    const vid=$('dlg-vertical').value; if(!vid){ alert('Pick a vertical first.'); return; }
    const vlabel=$('dlg-vertical').selectedOptions[0]?.textContent||vid;
    let ov=document.getElementById('dlgSrcMgr'); if(ov) ov.remove();
    ov=document.createElement('div'); ov.id='dlgSrcMgr';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
    ov.innerHTML=`<div style="background:#d4d0c8;border:2px outset #fff;padding:12px;width:min(560px,92vw);max-height:88vh;overflow:auto;font:12px Tahoma,sans-serif">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Sources — ${vlabel}</b><button id="dsm-x" style="cursor:pointer">✕</button></div>
      <div id="dsm-list" style="margin-bottom:10px"></div>
      <div>Name</div><input id="dsm-name" type="text" style="width:100%;box-sizing:border-box;margin-bottom:6px" placeholder="source name (e.g. vsl, testimonials)">
      <div>Text</div><textarea id="dsm-text" rows="7" style="width:100%;box-sizing:border-box" placeholder="paste transcript / source text"></textarea>
      <div style="margin-top:8px"><button id="dsm-save" style="cursor:pointer">Save source</button> <button id="dsm-clear" style="cursor:pointer">Clear</button> <span id="dsm-status" style="margin-left:8px;color:#444"></span></div>
    </div>`;
    document.body.appendChild(ov);
    const close=()=>ov.remove();
    ov.addEventListener('click',e=>{ if(e.target===ov) close(); });
    ov.querySelector('#dsm-x').onclick=close;
    const st=t=>{ ov.querySelector('#dsm-status').textContent=t||''; };
    async function list(){ const box=ov.querySelector('#dsm-list'); box.innerHTML='Loading…'; try{ const d=await fetch(`${API}/sources?theme=${DLG_THEME}&vertical=${encodeURIComponent(vid)}`).then(x=>x.json()); box.innerHTML=''; if(!d.sources||!d.sources.length){ box.innerHTML='<i>No sources yet.</i>'; return; } d.sources.forEach(s=>{ const row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;align-items:center;padding:3px 0'; row.innerHTML=`<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.key}</span><span style="color:#666;font-size:10px">${s.chars} ch</span>`; const ed=document.createElement('button'); ed.textContent='Edit'; ed.style.cursor='pointer'; ed.onclick=async()=>{ st('Loading…'); try{ const g=await fetch(`${API}/sources/get?theme=${DLG_THEME}&vertical=${encodeURIComponent(vid)}&key=${encodeURIComponent(s.key)}`).then(x=>x.json()); ov.querySelector('#dsm-name').value=s.key; ov.querySelector('#dsm-text').value=g.text||''; st('Editing "'+s.key+'".'); }catch(e){ st('Load failed.'); } }; const del=document.createElement('button'); del.textContent='Del'; del.style.cursor='pointer'; del.onclick=async()=>{ await fetch(`${API}/sources/delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:DLG_THEME,vertical:vid,key:s.key})}); list(); loadDlgSources(); }; row.appendChild(ed); row.appendChild(del); box.appendChild(row); }); }catch(e){ box.innerHTML='Failed.'; } }
    ov.querySelector('#dsm-clear').onclick=()=>{ ov.querySelector('#dsm-name').value=''; ov.querySelector('#dsm-text').value=''; st(''); };
    ov.querySelector('#dsm-save').onclick=async()=>{ const key=ov.querySelector('#dsm-name').value.trim(), text=ov.querySelector('#dsm-text').value; if(!key){ st('Name required.'); return; } if(!text.trim()){ st('Text required.'); return; } st('Saving…'); try{ const r=await fetch(`${API}/sources/set`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:DLG_THEME,vertical:vid,key,text})}).then(x=>x.json()); if(!r.success) throw new Error('save failed'); st('✓ Saved.'); ov.querySelector('#dsm-name').value=''; ov.querySelector('#dsm-text').value=''; list(); loadDlgSources(); }catch(e){ st('Error: '+(e.message||e)); } };
    list();
  }
  function _injectDlgCSS(){
    if(document.getElementById('dlg-css')) return;
    const s=document.createElement('style'); s.id='dlg-css';
    s.textContent=`
    #l1-scenarii-v2 #dlg-models{flex:0 1 280px;min-width:200px;order:10;overflow:auto}
    #l1-scenarii-v2 .dlg-acc{border:1px solid var(--border-soft);margin-bottom:8px;background:var(--bg);border-radius:var(--r-sm);overflow:hidden}
    #l1-scenarii-v2 .dlg-acc-h{width:100%;text-align:left;font-weight:650;color:var(--ink) !important;background:var(--surface-2) !important;border:0 !important;border-bottom:1px solid var(--border-soft) !important;border-radius:0 !important;box-shadow:none !important;padding:8px 11px;display:flex;justify-content:space-between;align-items:center;cursor:pointer}
    #l1-scenarii-v2 .dlg-acc-h:hover{background:var(--surface) !important}
    #l1-scenarii-v2 .dlg-acc-h .ar{transition:transform .12s;color:var(--muted)}
    #l1-scenarii-v2 .dlg-acc.open .dlg-acc-h .ar{transform:rotate(90deg)}
    #l1-scenarii-v2 .dlg-acc-body{display:none;max-height:44vh;overflow:auto;background:var(--bg);padding:2px 0}
    #l1-scenarii-v2 .dlg-acc.open .dlg-acc-body{display:block}
    #l1-scenarii-v2 .dlg-row{position:relative;display:flex;align-items:center;gap:8px;padding:5px 8px;margin:2px 5px;border:1px solid transparent;border-radius:var(--r-xs);cursor:default}
    #l1-scenarii-v2 .dlg-row:hover{background:var(--surface-2)}
    #l1-scenarii-v2 .dlg-row.active{border-color:var(--primary);background:var(--primary-soft)}
    #l1-scenarii-v2 .dlg-row-th{width:34px;height:34px;object-fit:cover;border:1px solid var(--border);flex:0 0 auto;background:var(--surface);border-radius:var(--r-xs)}
    #l1-scenarii-v2 .dlg-row-nm{flex:1;min-width:0;font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #l1-scenarii-v2 .dlg-badge{font-size:10px;font-weight:700;color:var(--primary-ink);background:var(--primary);border-radius:var(--r-xs);padding:1px 6px}
    #l1-scenarii-v2 .ios{position:relative;display:inline-block;width:34px;height:20px;flex:0 0 auto}
    #l1-scenarii-v2 .ios input{opacity:0;width:0;height:0}
    #l1-scenarii-v2 .ios .sl{position:absolute;inset:0;background:#bbb;border:1px solid #808080;border-radius:999px;cursor:pointer;transition:.15s}
    #l1-scenarii-v2 .ios .sl:before{content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.15s}
    #l1-scenarii-v2 .ios input:checked + .sl{background:#1a7a1a;border-color:#1a7a1a}
    #l1-scenarii-v2 .ios input:checked + .sl:before{transform:translateX(14px)}
    #l1-scenarii-v2 .dlg-flyout{position:fixed;z-index:9000;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:10px;display:none;gap:10px;align-items:flex-start;box-shadow:var(--shadow)}
    #l1-scenarii-v2 .dlg-flyout.on{display:flex}
    #l1-scenarii-v2 .dlg-flyout .notice{color:var(--muted)}
    #l1-scenarii-v2 .dlg-fly-portrait{width:140px;height:186px;object-fit:cover;border:1px solid var(--border);background:var(--surface-2);border-radius:var(--r-sm)}
    #l1-scenarii-v2 .dlg-fly-shots{display:flex;flex-wrap:wrap;gap:5px;width:240px;max-height:186px;overflow:auto;align-content:flex-start}
    #l1-scenarii-v2 .dlg-fly-shot{width:52px;height:52px;object-fit:cover;border:2px solid transparent;cursor:pointer;background:var(--surface-2);border-radius:var(--r-xs)}
    #l1-scenarii-v2 .dlg-fly-shot:hover{border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-fly-shot.sel{border-color:var(--success)}
    #l1-scenarii-v2 #dlg-runlog{font-size:11px;color:var(--muted);margin:6px 0 8px;white-space:pre-wrap}
    #l1-scenarii-v2 .dlg-line{display:flex;gap:6px;align-items:flex-start;margin-bottom:5px}
    #l1-scenarii-v2 .dlg-line .who{flex:0 0 46px;font-weight:700;font-size:11px;padding-top:5px}
    #l1-scenarii-v2 .dlg-line .who.host{color:var(--primary)}
    #l1-scenarii-v2 .dlg-line .who.guest{color:var(--accent)}
    #l1-scenarii-v2 .dlg-line textarea{flex:1;min-width:0;min-height:34px;resize:vertical;font-size:12px}
    #l1-scenarii-v2 #dlg-script{flex:0 1 340px;min-width:240px;order:11;overflow:auto}
    #l1-scenarii-v2 #dlg-work{flex:1 1 0;min-width:0;order:12}
    /* dialogues fills the panel: FULL WIDTH (no centering) + full height with an outer gap.
       #pl-dialogues stays a flex ITEM of #s2-root (flex:1); height flows via .wrap height:100% */
    #l1-scenarii-v2 #pl-dialogues{flex:1;min-height:0;overflow:hidden}
    #l1-scenarii-v2 #pl-dialogues .wrap{max-width:none;width:auto;margin:0;height:100%;box-sizing:border-box;padding:14px 20px;display:flex;flex-direction:column}
    #l1-scenarii-v2 #dlg-cols{flex:1;min-height:0}
    #l1-scenarii-v2 .dlg-col{min-height:0;overflow:auto;background:var(--surface) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-lg) !important;padding:12px !important}
    /* title bars use the midnight surface tokens (match the header rows), not bright navy */
    #l1-scenarii-v2 .dlg-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 0 10px;padding:7px 11px;background:var(--surface-2);border:1px solid var(--border-soft);border-radius:var(--r-sm)}
    #l1-scenarii-v2 .dlg-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);font-weight:650}
    #l1-scenarii-v2 .dlg-collapse{flex:0 0 auto;padding:0 7px;line-height:1.6;font-weight:700;cursor:pointer;color:var(--muted) !important;background:transparent !important;border:1px solid var(--border) !important;border-radius:var(--r-xs) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-collapse:hover{background:var(--surface) !important;color:var(--ink) !important}
    /* collapsed -> full-height strip docked to the LEFT (order), arrow ABOVE vertical title.
       per-id so it beats the per-id base flex/min-width above */
    #l1-scenarii-v2 #dlg-models.dlg-collapsed,#l1-scenarii-v2 #dlg-script.dlg-collapsed{flex:0 0 34px;min-width:34px;padding:0 !important;border-radius:var(--r-sm) !important;cursor:pointer;overflow:hidden}
    #l1-scenarii-v2 #dlg-models.dlg-collapsed{order:0}
    #l1-scenarii-v2 #dlg-script.dlg-collapsed{order:1}
    #l1-scenarii-v2 .card.dlg-collapsed .dlg-body{display:none}
    #l1-scenarii-v2 .card.dlg-collapsed .dlg-head{flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;margin:0;height:100%;border-radius:0;padding:8px 2px}
    #l1-scenarii-v2 .card.dlg-collapsed .dlg-collapse{order:1;border:0;background:transparent}
    #l1-scenarii-v2 .card.dlg-collapsed .dlg-title{order:2;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}
    /* work zone: clean/colored toggle, generation loader, scenario cards */
    #l1-scenarii-v2 .dlg-cc{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted)}
    #l1-scenarii-v2 #dlg-gen.danger{background:var(--danger) !important;color:#fff !important;border-color:transparent !important}
    #l1-scenarii-v2 .dlg-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;padding:52px 16px;text-align:center}
    #l1-scenarii-v2 .dlg-spinner{width:46px;height:46px;border-radius:50%;border:4px solid var(--border-soft);border-top-color:var(--primary);animation:dlg-spin .8s linear infinite}
    @keyframes dlg-spin{to{transform:rotate(360deg)}}
    #l1-scenarii-v2 .dlg-stage{font-size:12px;font-weight:650;color:var(--ink)}
    #l1-scenarii-v2 .dlg-phrase{font-size:12px;color:var(--muted);font-style:italic;min-height:1.2em}
    #l1-scenarii-v2 .dlg-scn{display:flex;flex-direction:column;gap:10px}
    #l1-scenarii-v2 .dlg-scn-row{display:flex;gap:10px;align-items:stretch}
    #l1-scenarii-v2 .dlg-card{flex:1;min-width:0;background:var(--bg);border:1px solid var(--border-soft);border-radius:var(--r-sm);padding:8px 10px}
    #l1-scenarii-v2 .dlg-card.host{border-left:3px solid var(--primary)}
    #l1-scenarii-v2 .dlg-card.guest{border-left:3px solid var(--accent)}
    #l1-scenarii-v2 .dlg-card-h{display:flex;align-items:center;gap:6px;margin-bottom:5px}
    #l1-scenarii-v2 .dlg-card-who{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--muted)}
    #l1-scenarii-v2 .dlg-card-tx{font-size:12.5px;line-height:1.5;color:var(--ink)}
    #l1-scenarii-v2 .dlg-tag{color:var(--primary);font-weight:600;font-size:11px}
    /* work header tools, card speaker slot, voice buttons, role picker */
    #l1-scenarii-v2 .dlg-head-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    #l1-scenarii-v2 .dlg-vall{font-size:11px !important;padding:3px 9px !important}
    #l1-scenarii-v2 .dlg-card-h{display:flex;align-items:center;gap:6px;margin-bottom:5px;justify-content:space-between}
    #l1-scenarii-v2 .dlg-card-spk{display:flex;align-items:center;gap:6px;min-width:0}
    #l1-scenarii-v2 .dlg-av{width:26px;height:26px;border-radius:50%;object-fit:cover;border:1px solid var(--border);cursor:pointer;flex:0 0 auto}
    #l1-scenarii-v2 .dlg-av:hover{border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-av-add{width:26px;height:26px;border-radius:50% !important;padding:0 !important;font-size:15px !important;line-height:1 !important;display:flex;align-items:center;justify-content:center;color:var(--muted) !important;background:var(--bg) !important;border:1px dashed var(--border) !important;cursor:pointer;flex:0 0 auto;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-av-add:hover{border-color:var(--primary) !important;color:var(--ink) !important}
    #l1-scenarii-v2 .dlg-card-voice{flex:0 0 auto;font-size:12px !important;padding:2px 7px !important;background:var(--surface-2) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-card-tx{outline:none}
    #l1-scenarii-v2 .dlg-card-tx:focus{box-shadow:inset 0 0 0 1px var(--primary);border-radius:4px}
    #l1-scenarii-v2 .dlg-pick{position:fixed;z-index:9100;width:228px;max-height:330px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:6px}
    #l1-scenarii-v2 .dlg-pick-h{font-size:11px;font-weight:700;color:var(--ink);padding:4px 6px 6px}
    #l1-scenarii-v2 .dlg-pick-g{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px 6px 2px}
    #l1-scenarii-v2 .dlg-pick-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--r-xs);cursor:pointer}
    #l1-scenarii-v2 .dlg-pick-row:hover{background:var(--surface-2)}
    #l1-scenarii-v2 .dlg-pick-row img{width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid var(--border)}
    #l1-scenarii-v2 .dlg-pick-row span{font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    /* cast pills (one per row) replace Host/Guest inputs */
    #l1-scenarii-v2 .dlg-cast{display:flex;flex-direction:column;gap:6px;margin-top:10px}
    #l1-scenarii-v2 .dlg-castpill{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border-soft);border-radius:var(--pill);padding:4px 12px 4px 4px}
    #l1-scenarii-v2 .dlg-castpill-th{width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex:0 0 auto;background:var(--surface)}
    #l1-scenarii-v2 .dlg-castpill-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--muted);flex:0 0 auto}
    #l1-scenarii-v2 .dlg-castpill-role{flex:1;min-width:0;background:transparent !important;border:0 !important;border-bottom:1px solid var(--border-soft) !important;border-radius:0 !important;padding:3px 2px !important;color:var(--ink);font-size:12px}
    #l1-scenarii-v2 .dlg-castpill-role:focus{border-bottom-color:var(--primary) !important;box-shadow:none !important;outline:none}
    /* compact optional selects/inputs in the generator column (still tall enough not to clip) */
    #l1-scenarii-v2 #dlg-script .fld>select,#l1-scenarii-v2 #dlg-script .fld>input{padding-top:4px !important;padding-bottom:4px !important;min-height:0 !important;height:auto !important;line-height:1.3}
    /* regen-confirm modal */
    #l1-scenarii-v2 .dlg-modal-ov{position:fixed;inset:0;z-index:9300;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
    #l1-scenarii-v2 .dlg-modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:16px 18px;width:min(420px,92vw)}
    #l1-scenarii-v2 .dlg-modal-h{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:6px}
    #l1-scenarii-v2 .dlg-modal-b{font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.4}
    #l1-scenarii-v2 .dlg-modal-f{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}`;
    document.head.appendChild(s);
  }
  async function buildModelsPanel(){
    const host=$('dlg-models'); if(!host) return;
    host.innerHTML='<h2>Models</h2><div class="notice" style="padding:6px 8px">Loading…</div>';
    let chars=[], obrazy=[];
    try{ const d=await fetch('/api/char-store/list').then(x=>x.json()); chars=(d&&d.chars)||[]; }catch(e){}
    try{ const d=await fetch('/api/userdata/obrazy').then(x=>x.json()); obrazy=(d&&d.list)||[]; }catch(e){}
    // photoshoots per character (obraz.charId === char.id): aggregate pool/variations
    const shotsBy={};   // per character: ONE main cover per photoshoot (obraz), no pose variations
    obrazy.forEach(o=>{ const cid=String(o.charId||''); if(!cid) return; const a=shotsBy[cid]||(shotsBy[cid]=[]);
      const main=(window.pickMainObrazImage&&window.pickMainObrazImage(o)) || o.char || (((Array.isArray(o.pool)?o.pool:[]).find(p=>p&&p.final&&p.file)||{}).file) || (((Array.isArray(o.pool)?o.pool:[])[0]||{}).file) || ((Array.isArray(o.variations)?o.variations:[])[0]);
      if(main) a.push(main); });
    chars.forEach(c=>{ const shots=shotsBy[String(c.id)]||[]; c._shots=Array.from(new Set(shots.length?shots:[c.portrait,c.baseFace].filter(Boolean))); c._portrait=c.portrait||c.baseFace||c._shots[0]||''; });
    const list=chars; _dlgModels=chars;
    const byG = g => list.filter(o => g==='other' ? !(o.gender==='male'||o.gender==='female') : o.gender===g);
    const groups=[['male','Males'],['female','Females'],['other','Other']];
    let html='';
    groups.forEach(([g,label],gi)=>{
      const items=byG(g);
      const rows = items.map(o=>{
        const img=_dlgModelImg(o), nm=String(o.name||'model').replace(/</g,'&lt;');
        return `<div class="dlg-row" data-id="${o.id}"><img class="dlg-row-th" src="${img}" alt=""><span class="dlg-row-nm">${nm}</span><span class="dlg-badge" style="display:none"></span><label class="ios"><input type="checkbox" class="dlg-row-tog"><span class="sl"></span></label></div>`;
      }).join('') || '<div class="notice" style="padding:6px 8px">none</div>';
      html += `<div class="dlg-acc${gi===0?' open':''}" data-g="${g}"><button class="dlg-acc-h" type="button"><span><span class="ar">▸</span> ${label}</span><span>${items.length}</span></button><div class="dlg-acc-body">${rows}</div></div>`;
    });
    host.innerHTML = _dlgHead('Models') + '<div class="dlg-body">' + html + '</div>';
    _wireCollapse(host);
    host.querySelectorAll('.dlg-acc-h').forEach(h=>h.addEventListener('click',()=>{
      const acc=h.parentElement, open=acc.classList.contains('open');
      host.querySelectorAll('.dlg-acc').forEach(a=>a.classList.remove('open'));
      if(!open) acc.classList.add('open');
    }));
    host.querySelectorAll('.dlg-row').forEach(row=>{
      const id=row.dataset.id;
      row.querySelector('.dlg-row-tog').addEventListener('change',e=>{ if(e.target.checked) activateModel(id); else deactivateModel(id); });
      row.addEventListener('mouseenter',()=>showFlyout(id,row));
      row.addEventListener('mouseleave',scheduleHideFlyout);
    });
    renderActive();
  }
  let _fly=null,_flyHideT=null;
  function _flyEl(){ if(_fly) return _fly; _fly=document.createElement('div'); _fly.className='dlg-flyout'; _fly.addEventListener('mouseenter',()=>clearTimeout(_flyHideT)); _fly.addEventListener('mouseleave',scheduleHideFlyout); (document.getElementById('l1-scenarii-v2')||document.body).appendChild(_fly); return _fly; }
  function scheduleHideFlyout(){ clearTimeout(_flyHideT); _flyHideT=setTimeout(()=>{ if(_fly) _fly.classList.remove('on'); _dlgSortActive(); },220); }
  function _dlgSortActive(){ const host=$('dlg-models'); if(!host) return; _activeIds().slice().reverse().forEach(id=>{ const r=_dlgRowFind(id); if(r&&r.parentElement) r.parentElement.insertBefore(r, r.parentElement.firstChild); }); }
  // anchor = element to position next to. opts.onPick(frame) overrides the default
  // (activate as L/R) behaviour — used by the card "+" role picker.
  function showFlyout(id,anchor,opts){
    clearTimeout(_flyHideT);
    const o=_dlgModels.find(x=>String(x.id)===String(id)); if(!o) return;
    const fly=_flyEl();
    const portrait=_dlgModelImg(o);
    const shots=(Array.isArray(o._shots)?o._shots:[]).filter(Boolean);
    fly.innerHTML = `<img class="dlg-fly-portrait" src="${portrait}"><div class="dlg-fly-shots">${ shots.length ? shots.map(f=>`<img class="dlg-fly-shot${dlgFrame[id]===f?' sel':''}" src="${f}" data-full="${f}">`).join('') : '<div class="notice">no photoshoots</div>' }</div>`;
    const big=fly.querySelector('.dlg-fly-portrait');
    let pinned=portrait;   // large image resets to portrait on each open
    fly.querySelectorAll('.dlg-fly-shot').forEach(im=>{
      im.addEventListener('mouseenter',()=>{ big.src=im.dataset.full; });
      im.addEventListener('mouseleave',()=>{ big.src=pinned; });
      im.addEventListener('click',()=>{
        if(opts&&opts.onPick){ opts.onPick(im.dataset.full); return; }
        pinned=im.dataset.full; big.src=pinned; dlgFrame[id]=im.dataset.full; activateModel(id);
        fly.querySelectorAll('.dlg-fly-shot').forEach(x=>x.classList.toggle('sel',x.dataset.full===dlgFrame[id]));
        const th=_dlgRowFind(id)?.querySelector('.dlg-row-th'); if(th) th.src=im.dataset.full;
      });
    });
    const rb=anchor.getBoundingClientRect();
    fly.style.top=Math.max(8,Math.min(rb.top,(window.innerHeight||800)-210))+'px';
    fly.style.left=(rb.right+6)+'px';
    fly.classList.add('on');
  }
  // dlgActive is a fixed 2-slot [host, guest]. Left-column toggle fills host then guest,
  // dropping the host when a 3rd is added; the card "+" picker assigns a specific slot.
  function activateModel(id){ id=String(id); if(dlgActive.includes(id)) return;
    if(!dlgActive[0]) dlgActive[0]=id; else if(!dlgActive[1]) dlgActive[1]=id; else { dlgActive[0]=dlgActive[1]; dlgActive[1]=id; }
    renderActive(); if(_dlgInited) renderDlgScenario(); }
  function deactivateModel(id){ id=String(id); if(dlgActive[0]===id) dlgActive[0]=null; if(dlgActive[1]===id) dlgActive[1]=null; renderActive(); if(_dlgInited) renderDlgScenario(); }
  function setRoleModel(speaker,id,frame){ id=String(id); const slot=speaker==='guest'?1:0;
    if(dlgActive[1-slot]===id) dlgActive[1-slot]=null;   // same model can't hold both roles
    dlgActive[slot]=id; if(frame) dlgFrame[id]=frame; renderActive(); renderDlgScenario(); }
  function renderActive(){
    const host=$('dlg-models'); if(!host) return;
    host.querySelectorAll('.dlg-row').forEach(row=>{
      const slot=dlgActive.indexOf(String(row.dataset.id)), on=slot>=0;
      row.classList.toggle('active',on);
      const t=row.querySelector('.dlg-row-tog'); if(t) t.checked=on;
      const b=row.querySelector('.dlg-badge'); if(b){ if(on){ b.style.display=''; b.textContent= slot===0?'L':'R'; } else b.style.display='none'; }
    });
    renderCastPills();
  }
  function _dlgRoleModel(speaker){ const id=speaker==='guest'?dlgActive[1]:dlgActive[0]; if(!id) return null; const m=_dlgModels.find(x=>String(x.id)===String(id)); if(!m) return null; return { id, name:m.name||'', frame: dlgFrame[id]||_dlgModelImg(m) }; }
  function verticalLabel(){ return $('vertical').selectedOptions[0]?.textContent || ''; }
  function autoTitle(){
    const t=$('title'); if(!t || t.dataset.dirty==='1') return;
    t.value = `${verticalLabel() || 'untitled'} — ${state.type}`;
  }

  async function loadSteps(){
    if(state.type==='dialogues') return;
    const p=gp();
    const r = await fetch(`${API}/lab/steps`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({theme:p.theme,type:p.type,taboo:p.taboo,vertical:p.vertical,scenesRange:p.scenesRange,roles:p.roles,voEnabled:p.voEnabled,voGender:p.voGender,narratorGender:p.narratorGender,structured:p.structured,notes:p.notes})}).then(x=>x.json());
    state.steps = r.steps||[];
    state.hooksPrompt = r.hooksPrompt||''; state.scriptMark = r.scriptMark||'';
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

  // 2-column layout: step PROMPTS render into the popup (#promptSteps); the LAST
  // step's RESULT renders into the right column (#resultHost); intermediate steps'
  // outputs are hidden (kept only to chain multi-step formats during Run).
  function renderSteps(){
    const last=state.steps.length;
    const promptHost=$('promptSteps'); if(promptHost) promptHost.innerHTML='';
    const hiddenOuts=$('hiddenOuts'); if(hiddenOuts) hiddenOuts.innerHTML='';
    const resultHost=$('resultHost'); if(resultHost) resultHost.innerHTML='';
    const cntHost=$('cntHost'); if(cntHost) cntHost.innerHTML='';
    const runMsgHost=$('runMsgHost'); if(runMsgHost) runMsgHost.innerHTML='';

    state.steps.forEach((s)=>{
      const isLast = s.n===last;
      // Prompt block (in the popup)
      if(promptHost){
        const pb=document.createElement('div'); pb.className='prompt-block';
        pb.innerHTML=`
          <div class="lbl">${s.n}. ${esc(s.title)}<span class="hltleg"><b style="color:#7a4a00">params</b> · <b style="color:#0a5a30">vertical library</b></span>
            <span class="sp"><select class="verSel" id="ver${s.n}" style="display:none" title="saved versions"></select><button class="btn-sm" data-save="${s.n}">💾 Save prompt</button>${s.n>1?`<button class="btn-sm" data-pull="${s.n}">⬇ draft</button>`:''}</span>
          </div>
          <div class="sys" id="sys${s.n}" contenteditable="true" spellcheck="false"></div>
          <span class="msg" id="pmsg${s.n}"></span>`;
        promptHost.appendChild(pb);
        pb.querySelector('.sys').innerHTML = hl(s.prompt);
      }
      state.tpl[s.n]=s.prompt;
      // Result element
      if(isLast){
        const ta=document.createElement('textarea'); ta.className='out'; ta.id='out'+s.n;
        ta.style.cssText='width:100%;box-sizing:border-box;min-height:360px';
        ta.placeholder='clean script appears here — press Run';
        if(resultHost) resultHost.appendChild(ta);
        if(cntHost) cntHost.innerHTML=`<span id="cnt${s.n}"></span>`;
        if(runMsgHost) runMsgHost.innerHTML=`<span class="msg" id="msg${s.n}" style="display:inline"></span>`;
      } else {
        const ta=document.createElement('textarea'); ta.id='out'+s.n; if(hiddenOuts) hiddenOuts.appendChild(ta);
        ['msg','cnt'].forEach(k=>{ const sp=document.createElement('span'); sp.id=k+s.n; if(hiddenOuts) hiddenOuts.appendChild(sp); });
      }
      renderVersions(s.n);
    });

    // Hooks prompt block (the 3rd pass) — editable + saveable, no result textarea.
    if(promptHost && state.hooksPrompt){
      const pb=document.createElement('div'); pb.className='prompt-block';
      pb.innerHTML=`
        <div class="lbl">🪝 Hooks (pass 3 — runs after the script)<span class="hltleg"><b style="color:#7a4a00">params</b> · <b style="color:#0a5a30">vertical library</b></span>
          <span class="sp"><button class="btn-sm" id="saveHooksPromptBtn">💾 Save prompt</button></span>
        </div>
        <div class="sys" id="sysHooks" contenteditable="true" spellcheck="false"></div>
        <span class="msg" id="pmsgHooks"></span>`;
      promptHost.appendChild(pb);
      pb.querySelector('#sysHooks').innerHTML = hl(state.hooksPrompt);
    }

    // Wire the dynamic prompt-block buttons
    if(promptHost){
      promptHost.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>saveStep(+b.dataset.save));
      promptHost.querySelectorAll('[data-pull]').forEach(b=>b.onclick=()=>{ const n=+b.dataset.pull; const pe=$('out'+(n-1)); const draft=(pe&&pe.value.trim()&&pe.value!==pe.dataset.clean)?pe.value.trim():(state.raw[n-1]||(pe&&pe.value.trim())||''); fillPrompt(n,draft); });
      const _sh=$('saveHooksPromptBtn'); if(_sh) _sh.onclick=saveHooksPrompt;
    }
    renderHookDropdown();
  }

  // Save the edited hooks prompt back to its file.
  async function saveHooksPrompt(){
    const p=gp(); const content=($('sysHooks')||{}).innerText||''; const msg=$('pmsgHooks');
    if(msg){ msg.className='msg run'; msg.textContent='saving…'; }
    try{
      const r=await fetch(`${API}/lab/save-hooks-prompt`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({theme:p.theme,type:p.type,content,taboo:p.taboo,vertical:p.vertical,roles:p.roles,narratorGender:p.narratorGender})}).then(x=>x.json());
      if(msg){ msg.className='msg '+(r.success?'ok':'err'); msg.textContent=r.success?'hooks prompt saved ✓ (placeholders preserved)':'save failed'; }
    }catch(e){ if(msg){ msg.className='msg err'; msg.textContent='✗ '+e.message; } }
  }

  // ── Embed a free-form thought into the FINAL script (one Hermes-4 pass) ──────
  let _embedPrev=null;
  async function embedThought(){
    const last=state.steps.length; const pe=$('out'+last); if(!pe) return;
    const scenario=(pe.value||'').trim();
    const thought=(($('sv2-embed-thought')||{}).value||'').trim();
    const msg=$('sv2-embed-msg');
    if(!scenario){ if(msg){msg.className='msg err';msg.textContent='Generate the final script first.';} return; }
    if(!thought){ if(msg){msg.className='msg err';msg.textContent='Write a thought to weave in.';} return; }
    const btn=$('sv2-embed-btn'); if(btn) btn.disabled=true;
    if(msg){ msg.className='msg run'; msg.innerHTML='<span class="spin"></span>weaving in…'; }
    try{
      const r=await fetch(`${API}/embed-thought`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario,thought})}).then(x=>x.json());
      if(!r.success) throw new Error(r.error||'failed');
      _embedPrev=pe.value;
      pe.value=r.scenario; pe.dataset.clean=r.scenario; state.raw[last]=r.scenario;
      const u=$('sv2-embed-undo'); if(u) u.style.display='';
      if(msg){ msg.className='msg ok'; msg.textContent='✓ woven in — check the text.'; }
    }catch(e){ if(msg){msg.className='msg err';msg.textContent='✗ '+e.message;} }
    finally{ if(btn) btn.disabled=false; }
  }
  function undoEmbed(){
    const last=state.steps.length; const pe=$('out'+last);
    if(_embedPrev!=null && pe){ pe.value=_embedPrev; pe.dataset.clean=_embedPrev; state.raw[last]=_embedPrev; _embedPrev=null;
      const u=$('sv2-embed-undo'); if(u) u.style.display='none'; const m=$('sv2-embed-msg'); if(m){m.className='msg';m.textContent='undone.';} }
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
        narratorGender:p.narratorGender, voEnabled:p.voEnabled, voGender:p.voGender, isLast,
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
  function _setBusy(on){ ['runAll','saveScenBtn','hookGen','sv2-embed-btn','reload'].forEach(id=>{ const b=$(id); if(b) b.disabled=!!on; }); }
  function _markRunning(n,on){ const c=$('steps')?.querySelector(`.step[data-step="${n}"]`); if(c) c.classList.toggle('running', !!on); }
  // Run the whole pipeline. The progress (spinner + step X/N) shows ON the button
  // the user clicked (top "Run all steps" OR the bottom "Run / regenerate"), and
  // the currently-running step card is highlighted.
  async function runAll(srcBtn){
    if(_piping) return;                  // guard against nested pipelines (double-click)
    ['title','ingredients','notes'].forEach(id=>{ const el=$(id); if(el) pushHistory(id, el.value); });   // remember used values
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
    const msg=$('pmsg'+n)||$('msg'+n); msg.className='msg run'; msg.textContent='saving…';
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
    if(!scriptText){ if(m){ m.className='msg err'; m.textContent='Run to generate the script first.'; } return; }
    m.className='msg run'; m.innerHTML='<span class="spin"></span>generating hooks…'; if(btn) btn.disabled=true;
    try{
      // Use the EDITED hooks prompt (pass 3) with the generated script substituted
      // into its {{SCRIPT}} marker; the backend runs it and parses 4 hooks.
      let body;
      const sh=$('sysHooks');
      if(sh && state.scriptMark){
        const prompt=(sh.innerText||'').split(state.scriptMark).join(scriptText);
        body={theme:p.theme,model:p.model,prompt};
      } else {
        body={theme:p.theme,vertical:p.vertical,taboo:p.taboo,roles:p.roles,narratorGender:p.narratorGender,model:p.model,script:scriptText};
      }
      const r=await fetch(`${API}/lab/hooks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
      if(!r.success) throw new Error(r.error||'failed');
      state.hooks=r.hooks||[];
      if(state.hooks.length){ state.chosenHook=state.hooks[0]; applyHookToScript(state.hooks[0]); }   // first hook auto-fills scene 1
      renderHookDropdown();
      m.className='msg ok'; m.textContent=`${state.hooks.length} hooks — first one is in scene 1. Pick another in the dropdown, ⭐ to save, ♻ to regenerate.`;
    }catch(e){ m.className='msg err'; m.textContent='✗ '+e.message; }
    finally{ if(btn) btn.disabled=false; }
  }
  // Fill the hook dropdown (4 hooks). Selecting one swaps scene 1 of the result.
  function renderHookDropdown(){
    const sel=$('hookSelect'), hg=$('hookGen'), st=$('hookStar');
    const has=!!(state.hooks&&state.hooks.length);
    if(hg) hg.style.display=has?'':'none';
    if(st) st.style.display=has?'':'none';
    if(!sel) return;
    sel.innerHTML='';
    if(!has){ const o=document.createElement('option'); o.value=''; o.textContent='— run to generate hooks —'; sel.appendChild(o); return; }
    state.hooks.forEach((h,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=(h.length>72?h.slice(0,70)+'…':h)+`  (${h.length})`; sel.appendChild(o); });
    const ci=state.hooks.indexOf(state.chosenHook); sel.value = ci>=0 ? String(ci) : '0';
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
    list.size = Math.max(2, Math.min(_opts.length, 12));   // fit rows to content so there are no empty (white) rows
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
    list.size = Math.max(2, Math.min(_tabs.length, 8));
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
          <div style="display:flex;gap:6px;align-items:center;margin:10px 12px;">
            <input type="text" id="svSearch" placeholder="search by title…" style="flex:1;margin:0;">
            <button class="btn-sm primary" id="svAdd" title="New scenario (manual)" style="padding:4px 11px;font-weight:700;">＋</button>
          </div>
          <div class="pl-sv-list" id="svList"></div>
        </div>
        <div class="pl-sv-detail" id="svDetail"></div>
      </div>`;
    ov.append(box); (ROOT()||document.body).append(ov);
    const wantId=(preferId!=null && list.some(s=>String(s.id)===String(preferId))) ? preferId : (list[0]&&list[0].id);
    _saved={ ov, list, selId:(wantId!=null?wantId:null), search:'' };
    box.querySelector('#svClose').onclick=closeSaved;
    box.querySelector('#svAdd').onclick=createBlankScenario;
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
      <div class="ss"><span class="badge">${esc(typeLabel(s.type))}</span><span>🎭 emotion: ${esc(_emoLabel(s.emotion)||'—')}</span><span>🎙 presenter: ${esc(_genderLabel(s))}</span><span>vertical: ${esc((s.vertical&&s.vertical.label)||'—')}</span><span>taboo: ${esc(s.taboo||'—')}</span><span>${(s.lines||[]).length} lines</span></div>`;
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
    const bEditScen=document.createElement('button'); bEditScen.className='btn-sm'; bEditScen.textContent='✎ Edit'; bEditScen.title='Edit title, emotion, gender and lines'; bEditScen.onclick=()=>openEditMode(s);
    const bEdit=document.createElement('button'); bEdit.className='btn-sm primary'; bEdit.textContent='⬈ Send to Edit'; bEdit.onclick=()=>sendToEdit(s);
    const bLoad=document.createElement('button'); bLoad.className='btn-sm'; bLoad.textContent='✎ Load into editor'; bLoad.onclick=()=>{ loadScenarioIntoEditor(s); closeSaved(); };
    const bDup=document.createElement('button'); bDup.className='btn-sm'; bDup.textContent='⧉ Duplicate'; bDup.onclick=()=>duplicateSaved(s.id);
    const bDel=document.createElement('button'); bDel.className='btn-sm'; bDel.style.color='var(--err)'; bDel.textContent='🗑 Delete'; bDel.onclick=()=>deleteSaved(s.id, bDel);
    foot.append(bEditScen, bEdit, bLoad, bDup, bDel);
    det.append(foot);
  }

  // Resolve an emotion id to its human label via the editor's #emotion dropdown.
  function _emoLabel(id){
    if(!id) return '';
    const sel=$('emotion');
    if(sel){ const o=[...sel.options].find(o=>String(o.value)===String(id)); if(o) return o.textContent; }
    return String(id);
  }
  // Presenter/narrator gender: roles[0].gender (on-camera) or narratorGender (voiceover).
  function _genderLabel(s){
    const g=String((s.roles&&s.roles[0]&&s.roles[0].gender) || s.narratorGender || 'any').toLowerCase();
    return g==='male'?'male ♂':g==='female'?'female ♀':'any';
  }

  // Create a new blank manual scenario, then open it in edit mode.
  async function createBlankScenario(){
    try{
      const body={ title:'New scenario', type:(state.type||'ugc_ad'), lines:[], emotion:'', narratorGender:'any', vertical:null, taboo:'' };
      const r=await fetch(`${API}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
      if(!r.success||!r.scenario) return;
      const d2=await fetch(`${API}/list`).then(x=>x.json()); _saved.list=(d2.success?d2.scenarios:[])||[];
      _saved.selId=r.scenario.id; renderSavedList();
      openEditMode(r.scenario);
    }catch{}
  }

  // Editable detail: title + emotion + presenter gender (both optional) + lines.
  function openEditMode(s){
    _saved.selId=s.id; renderSavedList();
    const det=_svq('#svDetail'); if(!det) return;
    det.innerHTML='';
    const head=document.createElement('div'); head.className='pl-sv-dhead';
    const tIn=document.createElement('input'); tIn.type='text'; tIn.value=s.title||''; tIn.placeholder='Scenario title';
    tIn.style.cssText='width:100%;font-size:14px;font-weight:700;margin-bottom:8px;';
    const pRow=document.createElement('div'); pRow.style.cssText='display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--mut);';
    const emoSel=document.createElement('select'); emoSel.style.fontSize='12px';
    const ne=document.createElement('option'); ne.value=''; ne.textContent='🎭 emotion (optional)'; emoSel.append(ne);
    const srcEmo=$('emotion');
    if(srcEmo) [...srcEmo.options].forEach(o=>{ if(!o.value) return; const op=document.createElement('option'); op.value=o.value; op.textContent=o.textContent; emoSel.append(op); });
    emoSel.value=s.emotion||'';
    const gSel=document.createElement('select'); gSel.style.fontSize='12px';
    [['any','🎙 narrator gender (optional)'],['female','female ♀'],['male','male ♂']].forEach(([v,l])=>{ const op=document.createElement('option'); op.value=v; op.textContent=l; gSel.append(op); });
    gSel.value=String((s.roles&&s.roles[0]&&s.roles[0].gender) || s.narratorGender || 'any');
    pRow.append(emoSel, gSel);
    head.append(tIn, pRow); det.append(head);

    // Per-line editable rows: number + text input + remove. Numbers auto-update.
    const linesWrap=document.createElement('div'); linesWrap.className='pl-sv-lines';
    const rowsHost=document.createElement('div'); rowsHost.style.cssText='display:flex;flex-direction:column;gap:4px;';
    function _renumber(){
      [...rowsHost.children].forEach((row,i)=>{ const n=row.querySelector('.dio-ln-num'); if(n) n.textContent=(i===0?'🪝 1':String(i+1)); });
    }
    function _addRow(text, focusIt){
      const row=document.createElement('div'); row.style.cssText='display:flex;align-items:center;gap:6px;';
      const num=document.createElement('span'); num.className='dio-ln-num'; num.style.cssText='flex:0 0 34px;text-align:right;font-size:10px;color:var(--mut);';
      const inp=document.createElement('input'); inp.type='text'; inp.value=text||''; inp.placeholder='line…'; inp.style.cssText='flex:1;font-size:12px;';
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); _addRow('', true); } });
      const del=document.createElement('button'); del.className='btn-sm'; del.textContent='✕'; del.title='Delete line'; del.style.cssText='padding:2px 7px;color:var(--err);flex:0 0 auto;';
      del.onclick=()=>{ row.remove(); if(!rowsHost.children.length) _addRow(''); _renumber(); };
      row.append(num, inp, del); rowsHost.append(row); _renumber();
      if(focusIt) inp.focus();
    }
    (s.lines||[]).forEach(l=>_addRow(l.text||''));
    if(!rowsHost.children.length) _addRow('');
    const addBtn=document.createElement('button'); addBtn.className='btn-sm'; addBtn.textContent='＋ line'; addBtn.style.cssText='margin-top:8px;align-self:flex-start;';
    addBtn.onclick=()=>_addRow('', true);
    linesWrap.append(rowsHost, addBtn); det.append(linesWrap);

    const foot=document.createElement('div'); foot.className='pl-sv-dfoot';
    const bSave=document.createElement('button'); bSave.className='btn-sm primary'; bSave.textContent='💾 Save';
    bSave.onclick=()=>saveEditedScenario(s, { title:tIn.value, emotion:emoSel.value, gender:gSel.value, lines:[...rowsHost.querySelectorAll('input')].map(i=>i.value) }, bSave);
    const bCancel=document.createElement('button'); bCancel.className='btn-sm'; bCancel.textContent='Cancel'; bCancel.onclick=()=>selectSaved(s.id);
    foot.append(bSave, bCancel); det.append(foot);
    tIn.focus();
  }

  async function saveEditedScenario(s, vals, btn){
    btn.disabled=true; const orig=btn.textContent; btn.textContent='⏳…';
    const srcLines=Array.isArray(vals.lines)?vals.lines:String(vals.linesText||'').split('\n');
    const lines=srcLines.map(t=>String(t).trim()).filter(Boolean).map(text=>({text}));
    const g=vals.gender||'any';
    const body={
      id:s.id,
      title:(vals.title||'').trim()||'(untitled)',
      type:s.type||state.type||'ugc_ad',
      emotion:vals.emotion||'',
      lines, sceneCount:lines.length,
      narratorGender:g,
      // also store on the on-camera role so the gender lock + display both read it
      roles:(s.roles&&s.roles.length)?s.roles.map((r,i)=>i===0?{...r,gender:g}:r):[{id:'r0',name:'Presenter',gender:g}],
    };
    try{
      const r=await fetch(`${API}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
      const d2=await fetch(`${API}/list`).then(x=>x.json()); _saved.list=(d2.success?d2.scenarios:[])||[];
      _saved.selId=(r.success&&r.scenario)?r.scenario.id:s.id;
      renderSavedList(); selectSaved(_saved.selId);   // back to read view (numbered lines)
    }catch(e){ btn.disabled=false; btn.textContent=orig; }
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
    ['title','ingredients','notes'].forEach(id=>attachHistory($(id), id));   // recent-values suggestions
    $('title').addEventListener('input',()=>{ $('title').dataset.dirty='1'; });
    $('theme').addEventListener('change',e=>{ state.theme=e.target.value; loadConfig(); });
    $('format').addEventListener('change',e=>setFormat(e.target.value));
    // Back/Forward between /scenarios/ugc_ad and /scenarios/dialogues swaps the layout.
    window.addEventListener('popstate', ()=>{ const want = location.pathname.endsWith('/dialogues') ? 'dialogues' : (state.type==='dialogues' ? 'ugc_ad' : state.type); if(want!==state.type) setFormat(want, true); });
    $('reload').onclick=loadSteps;
    $('runAll').onclick=()=>runAll($('runAll'));

    // Full-prompt popup (opened from the gear next to "Generation parameters")
    $('promptGear').onclick=()=>$('promptModal').classList.add('open');
    $('promptClose').onclick=()=>$('promptModal').classList.remove('open');
    $('promptModal').addEventListener('mousedown',e=>{ if(e.target.id==='promptModal') $('promptModal').classList.remove('open'); });

    // Right column: hooks dropdown + save scenario + weave-in (static elements)
    $('hookGen').onclick=genHooks;
    $('hookStar').onclick=()=>{ const h=state.hooks[+($('hookSelect').value)]; if(h) saveHookToBase(h); };
    $('hookSelect').onchange=()=>{ const h=state.hooks[+($('hookSelect').value)]; if(h){ state.chosenHook=h; applyHookToScript(h); } };
    $('saveScenBtn').onclick=()=>saveScenario(state.steps.length);
    $('sv2-embed-btn').onclick=embedThought;
    $('sv2-embed-undo').onclick=undoEmbed;

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
    // Apply the format from the URL sub-path (/scenarios/dialogues -> dialogues; else ugc_ad default).
    try {
      if(location.pathname.endsWith('/dialogues')) setFormat('dialogues', true);
      else if(location.pathname.replace(/\/+$/,'')==='/scenarios') history.replaceState({}, '', '/scenarios/ugc_ad');
    } catch(e){}
  }

  window.ScenariosV2 = { activate };
})();
