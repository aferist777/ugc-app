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
    <button class="pl-tab" id="modeBtn" type="button" title="Theme / format">Scenario ▾</button>
    <span id="mode-selects" style="display:none"><select id="theme" title="Theme"></select><select id="format" title="Format"></select></span>
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
    <button class="pl-tab" id="dlgMergeBtn" type="button" style="display:none" title="Send the ready video fragments to Merge (main track)">🎬 Merge</button>
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
      <div class="card dlg-col" id="dlg-video"></div>
      <div class="card dlg-col" id="dlg-work"><div class="dlg-head"><span class="dlg-title">Script &amp; work</span></div><div class="dlg-body"><div class="notice">scenario + further work — coming next</div></div></div>
    </div>
  </div></div>

  <!-- UGC-ad dialogues-style view (Phase 3): Character | Scenario | Video setup | Fragments -->
  <div id="pl-ugc" style="display:none"><div class="wrap">
    <div style="display:flex;gap:14px" id="ugc-cols">
      <div class="card dlg-col" id="ugc-char"></div>
      <div class="card dlg-col" id="ugc-script"></div>
      <div class="card dlg-col" id="ugc-video"></div>
      <div class="card dlg-col" id="ugc-work"></div>
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
    if(typeof _updateModeBtn==='function') _updateModeBtn();   // refresh the header mode button label
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
    const ugc = (id === 'ugc_ad');   // new dialogues-style fragment view (Phase 3)
    const nw=$('pl-new'), pd=$('pl-dialogues'), pu=$('pl-ugc');
    if(nw) nw.style.display = (dlg||ugc) ? 'none' : '';
    if(pd) pd.style.display = dlg ? '' : 'none';
    if(pu) pu.style.display = ugc ? '' : 'none';
    const mw=$('model-wrap'), pw=$('dlg-proj-wrap');   // header: model select (ugc) <-> projects (dialogues)
    if(mw) mw.style.display = dlg ? 'none' : '';
    if(pw) pw.style.display = dlg ? '' : 'none';
    const mg=$('dlgMergeBtn'); if(mg){ mg.style.display = dlg ? '' : 'none'; if(dlg && !mg._wired){ mg._wired=true; mg.addEventListener('click',_dlgSendToMerge); } }
    const f=$('format'); if(f && f.value!==id) f.value=id;
    if(!noPush){ try{ history.pushState({}, '', '/scenarios/'+id); }catch(e){} }
    if(dlg){ state.type='dialogues'; initDialogues(); setTimeout(_dlgFitHeight,30); }
    else { selectType(id); }   // keeps ugc state consistent (#pl-new hidden when ugc)
    if(ugc){ initUgc(); setTimeout(_ugcFitHeight,30); }
    _updateModeBtn();
  }
  // ── header mode button: replaces the Theme + Format dropdowns; grouped by theme ──
  function _modeCleanLabel(o){ return o ? o.textContent.replace(/^⏸\s*/,'').replace(/\s*—\s*paused$/i,'') : 'Scenario'; }
  function _updateModeBtn(){ const b=$('modeBtn'), f=$('format'); if(b&&f) b.textContent=_modeCleanLabel(f.selectedOptions&&f.selectedOptions[0])+' ▾'; }
  function _injectModeCss(){ if(document.getElementById('mode-dd-css')) return; const s=document.createElement('style'); s.id='mode-dd-css'; s.textContent=`
    #l1-scenarii-v2 #mode-dd{position:fixed;z-index:9500;min-width:210px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:6px}
    #l1-scenarii-v2 .mode-dd-theme{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--ink);padding:5px 8px 7px;border-bottom:1px solid var(--border-soft);margin-bottom:4px}
    #l1-scenarii-v2 .mode-dd-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font-size:12px;padding:6px 10px;background:transparent;border:none;border-radius:var(--r-sm);color:var(--ink);cursor:pointer}
    #l1-scenarii-v2 .mode-dd-item:hover:not(.dev){background:var(--surface-2)}
    #l1-scenarii-v2 .mode-dd-item.sel{color:var(--primary);font-weight:700}
    #l1-scenarii-v2 .mode-dd-item.dev{color:var(--muted);opacity:.55;cursor:not-allowed}
    #l1-scenarii-v2 .mode-dd-dev{margin-left:auto;font-size:8px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border:1px solid var(--border-soft);border-radius:var(--pill);padding:0 6px}`; document.head.appendChild(s); }
  let _modeDDcloseT=null;
  function _closeModeDropdown(){ const dd=document.getElementById('mode-dd'); if(dd) dd.remove(); document.removeEventListener('mousedown',_modeDDdoc,true); }
  function _modeDDdoc(e){ const dd=document.getElementById('mode-dd'), b=$('modeBtn'); if(dd && !dd.contains(e.target) && e.target!==b) _closeModeDropdown(); }
  function _openModeDropdown(anchor){
    if(document.getElementById('mode-dd')) return;
    _injectModeCss();
    const f=$('format'); if(!f) return;
    const themeName=($('theme')&&$('theme').value)||'marketing';
    const dd=document.createElement('div'); dd.id='mode-dd';
    let html=`<div class="mode-dd-theme">${themeName}</div>`;
    Array.prototype.forEach.call(f.options,o=>{ const dev=o.disabled; const lbl=_modeCleanLabel(o);
      html+=`<button class="mode-dd-item${dev?' dev':''}${o.value===f.value?' sel':''}" type="button" data-v="${o.value}"${dev?' disabled':''}>${lbl}${dev?'<span class="mode-dd-dev">in development</span>':''}</button>`; });
    dd.innerHTML=html;
    (document.getElementById('l1-scenarii-v2')||document.body).appendChild(dd);
    const rb=anchor.getBoundingClientRect(); dd.style.top=(rb.bottom+4)+'px'; dd.style.left=Math.max(8,rb.left)+'px';
    dd.querySelectorAll('.mode-dd-item:not(.dev)').forEach(it=>it.addEventListener('click',()=>{ if(f.value!==it.dataset.v){ f.value=it.dataset.v; f.dispatchEvent(new Event('change')); } _closeModeDropdown(); }));
    dd.addEventListener('mouseenter',()=>clearTimeout(_modeDDcloseT));
    dd.addEventListener('mouseleave',()=>{ _modeDDcloseT=setTimeout(_closeModeDropdown,350); });
    setTimeout(()=>document.addEventListener('mousedown',_modeDDdoc,true),0);
  }
  function _toggleModeDropdown(anchor){ if(document.getElementById('mode-dd')) _closeModeDropdown(); else _openModeDropdown(anchor); }
  let _dlgInited=false;
  // ── Q1: left model list (Males/Females/Other accordions; hover flyout with
  // photoshoots; click a photoshoot -> auto-activate + choose frame; max 2 active = L/R) ──
  let _dlgModels=[], dlgActive=[null, null], dlgFrame={};   // dlgActive = [hostId, guestId] (slots; null = empty)
  function _activeIds(){ return dlgActive.filter(Boolean); }
  function _dlgModelImg(o){ return o._portrait || o.portrait || o.baseFace || o.char || ''; }   /* portrait only, never tpose */
  // frame used in casting when no photoshoot was explicitly chosen: latest photoshoot, else portrait
  function _dlgDefaultFrame(id){ if(dlgFrame[id]) return dlgFrame[id]; const m=_dlgModels.find(x=>String(x.id)===String(id)); return (m&&(m._latestShot||_dlgModelImg(m)))||''; }
  function _dlgRowFind(id){ const h=$('dlg-models'); return h ? Array.prototype.find.call(h.querySelectorAll('.dlg-row'), r=>String(r.dataset.id)===String(id)) : null; }
  function initDialogues(){ if(_dlgInited) return; _dlgInited=true; _injectDlgCSS(); buildModelsPanel(); buildScriptPanel(); buildVideoPanel(); buildWorkPanel();
    const dd=$('dlg-project'); if(dd&&!dd._wired){ dd._wired=true; dd.addEventListener('change',()=>{ if(dd.value) loadProject(dd.value); }); }
    const del=$('dlg-proj-del'); if(del&&!del._wired){ del._wired=true; del.addEventListener('click',()=>{ const id=($('dlg-project')||{}).value||_dlgCurProject; if(id) deleteProject(id); }); }
    const ntab=$('plTabNew'); if(ntab&&!ntab._dlgWired){ ntab._dlgWired=true; ntab.addEventListener('click',e=>{ if(state.type!=='dialogues') return; e.preventDefault(); e.stopPropagation(); _dlgNewMenu(ntab); }); }
    if(!window._dlgFitWired){ window._dlgFitWired=true; window.addEventListener('resize',()=>{ if(state.type==='dialogues') _dlgFitHeight(); }); }
    _dlgLoadVideoDefaults();
    loadProjectsList();
    setTimeout(_dlgFitHeight,30);
  }
  function _dlgHead(title){ return `<div class="dlg-head"><span class="dlg-title">${title}</span><button class="dlg-collapse" type="button" title="Collapse">◂</button></div>`; }
  function _dlgSetCollapsed(host,c){ if(!host) return; host.classList.toggle('dlg-collapsed',c); const b=host.querySelector('.dlg-collapse'); if(b) b.textContent=c?'▸':'◂'; }
  // Video setup is mutually exclusive with Models+Dialogue: opening it collapses both;
  // opening Models or Dialogue collapses Video setup.
  function _dlgExclusive(id){
    if(id==='dlg-video'){ _dlgSetCollapsed($('dlg-models'),true); _dlgSetCollapsed($('dlg-script'),true); }
    else if(id==='dlg-models'||id==='dlg-script'){ _dlgSetCollapsed($('dlg-video'),true); }
  }
  function _wireCollapse(host){ const btn=host&&host.querySelector('.dlg-collapse'); if(!btn) return;
    const set=c=>{ _dlgSetCollapsed(host,c); if(!c) _dlgExclusive(host.id); };
    btn.addEventListener('click',e=>{ e.stopPropagation(); set(!host.classList.contains('dlg-collapsed')); });
    host.addEventListener('click',()=>{ if(host.classList.contains('dlg-collapsed')) set(false); }); }
  // Video setup column (collapsed by default). Phase 1 = skeleton; cast/pose/location come next.
  function buildVideoPanel(){
    const host=$('dlg-video'); if(!host) return;
    host.innerHTML = `
      <div class="dlg-head"><span class="dlg-title">Video setup</span><button class="dlg-gear" type="button" title="Engine settings">&#9881;</button><button class="dlg-collapse" type="button" title="Collapse">◂</button></div>
      <div class="dlg-body">
        <div class="dlg-vs-cast" id="dlg-vs-cast"></div>
        <label class="dlg-vs-row"><span>Format</span><select id="dlg-vs-format" class="dlg-vs-sel"><option value="9:16">9:16 (vertical)</option><option value="16:9">16:9 (wide)</option></select></label>
        <label class="dlg-vs-row"><span>Camera</span><select id="dlg-vs-camera" class="dlg-vs-sel"></select></label>
        <div class="dlg-vs-row"><span>Location</span><div class="dlg-vs-ddwrap" id="dlg-vs-loc"></div></div>
        <div class="dlg-vs-row"><span>Pose</span><div class="dlg-vs-ddwrap" id="dlg-vs-pose"></div><label class="dlg-ios" title="Mirror (iPhone)"><input type="checkbox" id="dlg-vs-mirror"><span class="dlg-ios-track"><span class="dlg-ios-knob"></span></span></label></div>
        <div class="dlg-vs-poserow"><button class="dlg-vs-genbtn" id="dlg-vs-genposes" type="button">Generate poses</button></div>
        <div class="dlg-vs-poseprog" id="dlg-vs-poseprog"></div>
      </div>`;
    _wireCollapse(host);
    _dlgSetCollapsed(host, true);   // default collapsed
    renderVideoCast();
    const fmt=$('dlg-vs-format'); if(fmt){ fmt.value=dlgVideo.format||'9:16'; fmt.addEventListener('change',()=>{ dlgVideo.format=fmt.value; dlgVideo.pose=null; _dlgLoadPoses().then(_dlgRenderPoseDD); renderVideoCast(); _dlgAutosave(); }); }
    const cam=$('dlg-vs-camera'); if(cam){ cam.innerHTML=DLG_CAMERAS.map(c=>`<option value="${c.id}">${c.label}</option>`).join(''); cam.value=dlgVideo.camera||'iphone-wide'; cam.addEventListener('change',()=>{ dlgVideo.camera=cam.value; _dlgAutosave(); _dlgSaveVideoDefaults(); }); }
    _dlgLoadEnvs().then(()=>{ const loc=$('dlg-vs-loc'); if(loc) _dlgThumbDD(loc, ()=> (_dlgEnvs||[]).map(e=>({id:e.path,thumb:e.thumbPath||e.path,label:''})), ()=>dlgVideo.location, v=>{ dlgVideo.location=v; }, 'Pick a location'); });
    const mir=$('dlg-vs-mirror'); if(mir){ mir.checked=!!dlgVideo.mirror; mir.addEventListener('change',()=>{ dlgVideo.mirror=mir.checked; _dlgRenderPoseDD(); _dlgAutosave(); }); }
    const gb=$('dlg-vs-genposes'); if(gb) gb.addEventListener('click', _dlgGenPoses);
    const gear=host.querySelector('.dlg-gear'); if(gear) gear.addEventListener('click', e=>{ e.stopPropagation(); _dlgOpenEnginePopup(gear); });
    _dlgLoadPoses().then(_dlgRenderPoseDD);
  }
  // camera / lens presets -> injected into the "both" composite prompt (Phase 6)
  const DLG_CAMERAS=[
    { id:'iphone-wide',  label:'iPhone wide (24mm f/1.8)',    spec:'shot on an iPhone main camera, 24mm-equivalent wide angle, f/1.8' },
    { id:'iphone-tele',  label:'iPhone tele (77mm f/2.8)',    spec:'shot on an iPhone telephoto lens, 77mm-equivalent, f/2.8, slightly compressed perspective' },
    { id:'dslr-35',      label:'DSLR 35mm f/2',               spec:'shot on a DSLR with a 35mm lens, f/2, documentary look' },
    { id:'dslr-50',      label:'DSLR 50mm f/1.8',             spec:'shot on a DSLR with a 50mm lens, f/1.8, natural perspective' },
    { id:'portrait-85',  label:'Portrait 85mm f/1.4',         spec:'shot on an 85mm portrait lens, f/1.4, shallow depth of field with a softly blurred background' },
    { id:'anamorphic-40',label:'Cinema anamorphic 40mm',      spec:'shot on an anamorphic cinema lens, ~40mm, subtle horizontal lens flares, cinematic widescreen feel' },
    { id:'webcam',       label:'Webcam / podcast cam',        spec:'shot on a laptop webcam, soft contrast, slight grain, casual podcast look' },
  ];
  // i2i / edit engines (composite "both" image) pulled live from engine-settings.js
  function _dlgI2IEngines(){ const S=window.ENGINE_SCHEMAS||{}; return Object.keys(S).filter(k=>(S[k].kind==='image'||!S[k].kind)&&Array.isArray(S[k].capabilities)&&S[k].capabilities.includes('i2i')).map(k=>({id:k,label:S[k].label||k})); }
  // global defaults: last chosen values become the defaults new dialogue projects inherit.
  let _dlgDefT=null, _dlgDefaults=null;
  function _dlgSaveVideoDefaults(){ clearTimeout(_dlgDefT); _dlgDefT=setTimeout(()=>{ try{ fetch('/api/dialogue/video-defaults',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engine:dlgVideo.engine,engineParams:dlgVideo.engineParams,camera:dlgVideo.camera,seedTiming:dlgVideo.seedTiming,seedImprove:dlgVideo.seedImprove,bothTwoStep:dlgVideo.bothTwoStep,resolution:dlgVideo.resolution,nsfw:dlgVideo.nsfw})}).catch(()=>{}); }catch(e){} },500); }
  function _dlgApplyDefaults(){ if(!_dlgDefaults) return; ['engine','engineParams','camera','seedTiming','seedImprove','bothTwoStep','resolution','nsfw'].forEach(k=>{ if(_dlgDefaults[k]!=null) dlgVideo[k]=_dlgDefaults[k]; }); _dlgVideoApplyState(); }
  async function _dlgLoadVideoDefaults(){ try{ const d=await fetch('/api/dialogue/video-defaults').then(r=>r.json()); _dlgDefaults=(d&&d.defaults)||null; }catch(e){ _dlgDefaults=null; } if(_dlgDefaults && !_dlgCurProject) _dlgApplyDefaults(); return _dlgDefaults; }
  function _dlgEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _dlgHlSys(t){ return _dlgEsc(t).replace(/\[\[(\w+)\]\]/g,'<span class="dlg-sys-chip" contenteditable="false">[[$1]]</span>'); }
  function _dlgOpenEnginePopup(anchor){
    const ex=document.getElementById('dlg-eng-pop'); if(ex){ ex.remove(); return; }   // toggle
    const engines=_dlgI2IEngines();
    if(!dlgVideo.engine||!engines.find(e=>e.id===dlgVideo.engine)) dlgVideo.engine=(engines[0]&&engines[0].id)||'nano-banana-2';
    const ios=(id,label,tip,iostip)=>`<label class="dlg-vs-row"><span title="${_dlgAttr(tip)}">${label}</span><label class="dlg-ios" title="${_dlgAttr(iostip)}"><input type="checkbox" id="${id}"><span class="dlg-ios-track"><span class="dlg-ios-knob"></span></span></label></label>`;
    const pop=document.createElement('div'); pop.id='dlg-eng-pop'; pop.className='dlg-eng-pop wide';
    pop.innerHTML=`<div class="dlg-eng-head">&#9881; Engine settings <span class="dlg-eng-x" title="Close">&times;</span></div>
      <div class="dlg-eng-cols">
        <div class="dlg-eng-col">
          <div class="dlg-eng-sub">Image engine &mdash; Both</div>
          <label class="dlg-vs-row"><span>Engine</span><select id="dlg-eng-sel" class="dlg-vs-sel">${engines.map(e=>`<option value="${e.id}">${_dlgAttr(e.label)}</option>`).join('')||'<option>nano-banana-2</option>'}</select></label>
          <div id="dlg-eng-form" class="dlg-eng-form"></div>
          ${ios('dlg-eng-twostep','Two-step','Two-step compose: host first, then guest (fallback for tough two-person composites).','OFF = one-shot  /  ON = two-step')}
        </div>
        <div class="dlg-eng-col">
          <div class="dlg-eng-sub">Video engine &mdash; Seedance 2.0 mini</div>
          <label class="dlg-vs-row"><span title="Output video resolution.">Quality</span><select id="dlg-eng-quality" class="dlg-vs-sel"><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
          ${ios('dlg-eng-timing','Cut timing','OFF: cuts described by words (Seedance times them to the audio). ON: cut on Whisper word timings (precise timecodes).','OFF = by words  /  ON = Whisper timings')}
          ${ios('dlg-eng-improve','Improve speech','OFF: use the original voice track exactly as recorded. ON: Seedance improves pronunciation, keeping the same voice.','OFF = original track  /  ON = improve (same voice)')}
          ${ios('dlg-eng-nsfw','NSFW filter','OFF: no content filter (allows spicy). ON: enable the Seedance NSFW checker.','OFF = no filter  /  ON = NSFW checker')}
          <button id="dlg-eng-sysbtn" class="dlg-eng-sysbtn" type="button" title="Read / edit the video-generation system prompt">&#9998; System prompt</button>
        </div>
      </div>`;
    (document.getElementById('l1-scenarii-v2')||document.body).appendChild(pop);
    const save=()=>{ _dlgAutosave(); _dlgSaveVideoDefaults(); };
    const sel=pop.querySelector('#dlg-eng-sel'); sel.value=dlgVideo.engine;
    const mountForm=()=>{ const box=pop.querySelector('#dlg-eng-form'); box.innerHTML=''; if(window.buildEngineSettingsRow){ const row=window.buildEngineSettingsRow(dlgVideo.engine, dlgVideo.engineParams||{}, vals=>{ dlgVideo.engineParams=vals; save(); }); box.appendChild(row.node); } else box.textContent='engine-settings.js not loaded'; };
    mountForm();
    sel.addEventListener('change',()=>{ dlgVideo.engine=sel.value; dlgVideo.engineParams={}; mountForm(); save(); });
    const q=pop.querySelector('#dlg-eng-quality'); if(q){ q.value=dlgVideo.resolution||'480p'; q.addEventListener('change',()=>{ dlgVideo.resolution=q.value; save(); }); }
    const ts=pop.querySelector('#dlg-eng-twostep'); if(ts){ ts.checked=!!dlgVideo.bothTwoStep; ts.addEventListener('change',()=>{ dlgVideo.bothTwoStep=ts.checked; save(); }); }
    const tt=pop.querySelector('#dlg-eng-timing'); if(tt){ tt.checked=(dlgVideo.seedTiming==='timed'); tt.addEventListener('change',()=>{ dlgVideo.seedTiming=tt.checked?'timed':'words'; save(); }); }
    const im=pop.querySelector('#dlg-eng-improve'); if(im){ im.checked=(dlgVideo.seedImprove!==false); im.addEventListener('change',()=>{ dlgVideo.seedImprove=im.checked; save(); }); }
    const nf=pop.querySelector('#dlg-eng-nsfw'); if(nf){ nf.checked=!!dlgVideo.nsfw; nf.addEventListener('change',()=>{ dlgVideo.nsfw=nf.checked; save(); }); }
    const sb=pop.querySelector('#dlg-eng-sysbtn'); if(sb) sb.addEventListener('click',e=>{ e.stopPropagation(); _dlgOpenPromptEditor(); });
    const rb=anchor.getBoundingClientRect();
    pop.style.top=Math.min(rb.bottom+6,(window.innerHeight||800)-400)+'px';
    pop.style.left=Math.max(8,Math.min(rb.right-560,(window.innerWidth||1200)-568))+'px';
    const close=()=>{ pop.remove(); document.removeEventListener('mousedown',onDoc,true); };
    const onDoc=e=>{ const sysp=document.getElementById('dlg-sys-pop'); if(!pop.contains(e.target)&&e.target!==anchor&&!(sysp&&sysp.contains(e.target))) close(); };
    pop.querySelector('.dlg-eng-x').addEventListener('click',close);
    setTimeout(()=>document.addEventListener('mousedown',onDoc,true),0);
  }
  async function _dlgOpenPromptEditor(){
    const ex=document.getElementById('dlg-sys-pop'); if(ex){ ex.remove(); return; }
    let st; try{ st=await fetch('/api/dialogue/ep-prompt').then(r=>r.json()); }catch(e){ st=null; }
    if(!st) return;
    const pop=document.createElement('div'); pop.id='dlg-sys-pop'; pop.className='dlg-sys-pop';
    const verOpts=`<option value="original"${st.activeId==='original'?' selected':''}>Original (built-in)</option>`+(st.versions||[]).map(v=>`<option value="${v.id}"${v.id===st.activeId?' selected':''}>${_dlgEsc(new Date(v.ts).toLocaleString())}</option>`).join('');
    pop.innerHTML=`<div class="dlg-sys-head"><span class="dlg-sys-title">&#9998; Video system prompt</span><select id="dlg-sys-ver" class="dlg-vs-sel" title="Prompt version (rollback)">${verOpts}</select><button id="dlg-sys-reset" type="button" title="Reset to the built-in prompt">Reset</button><button id="dlg-sys-save" type="button" class="dlg-sys-save" title="Save as a new version">Save</button><span class="dlg-sys-x" title="Close">&times;</span></div>
      <div class="dlg-sys-legend">Highlighted <b>[[chips]]</b> are auto-filled from the project &mdash; don't edit them. Everything else you can edit / add. Prompt changes are saved only with <b>Save</b>.</div>
      <div id="dlg-sys-ed" class="dlg-sys-ed" contenteditable="true" spellcheck="false"></div>
      <div class="dlg-sys-status" id="dlg-sys-status"></div>`;
    document.getElementById('l1-scenarii-v2').appendChild(pop);
    const ed=pop.querySelector('#dlg-sys-ed'), ver=pop.querySelector('#dlg-sys-ver'), status=pop.querySelector('#dlg-sys-status');
    const setText=t=>{ ed.innerHTML=_dlgHlSys(t||''); };
    setText(st.active||st.original);
    ed.addEventListener('input',()=>{ clearTimeout(ed._t); ed._t=setTimeout(()=>{ const pos=_dlgCaretOffset(ed); ed.innerHTML=_dlgHlSys(ed.textContent); if(pos!=null) _dlgSetCaret(ed,pos); },350); });
    ver.addEventListener('change',async()=>{ const id=ver.value; try{ if(id==='original'){ await fetch('/api/dialogue/ep-prompt/reset',{method:'POST'}); setText(st.original); status.textContent='Rolled back to built-in.'; } else { await fetch('/api/dialogue/ep-prompt/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); const v=(st.versions||[]).find(x=>x.id===id); setText((v&&v.text)||st.original); status.textContent='Switched to this version.'; } }catch(e){ status.textContent='Error.'; } });
    pop.querySelector('#dlg-sys-reset').addEventListener('click',async()=>{ try{ await fetch('/api/dialogue/ep-prompt/reset',{method:'POST'}); setText(st.original); ver.value='original'; status.textContent='Reset to built-in.'; }catch(e){ status.textContent='Error.'; } });
    pop.querySelector('#dlg-sys-save').addEventListener('click',async()=>{ const text=ed.textContent; try{ const r=await fetch('/api/dialogue/ep-prompt/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}).then(x=>x.json()); st.versions.unshift({id:r.id,ts:Date.now(),text}); const opt=document.createElement('option'); opt.value=r.id; opt.textContent=new Date().toLocaleString(); opt.selected=true; ver.insertBefore(opt, ver.children[1]||null); status.textContent='Saved.'; }catch(e){ status.textContent='Save failed.'; } });
    const cx=()=>{ try{ pop.remove(); }catch(e){} document.removeEventListener('mousedown',onDoc,true); };
    const onDoc=e=>{ if(!pop.contains(e.target)) cx(); };
    pop.querySelector('.dlg-sys-x').addEventListener('click',cx);
    setTimeout(()=>document.addEventListener('mousedown',onDoc,true),0);
  }
  // ── interview-pose library (Video setup) ──
  let _dlgPoses=[], _dlgPoseAbort=null;
  async function _dlgLoadPoses(){ const f=dlgVideo.format||'9:16'; try{ const d=await fetch('/api/dialogue/poses?format='+encodeURIComponent(f)).then(x=>x.json()); _dlgPoses=(d&&d.poses)||[]; }catch(e){ _dlgPoses=[]; } return _dlgPoses; }
  function _dlgPoseItems(){ return (_dlgPoses||[]).map(p=>({ id:p.id, thumb:(dlgVideo.mirror&&p.mirrorThumb)?p.mirrorThumb:p.thumb, label:p.label||'' })); }
  function _dlgRenderPoseDD(){ const host=$('dlg-vs-pose'); if(!host) return; if(!host._render){ _dlgThumbDD(host, _dlgPoseItems, ()=>dlgVideo.pose, v=>{ dlgVideo.pose=v; renderVideoCast(); }, 'Pick a pose'); } else host._render(); }
  async function _dlgGenPoses(){
    const btn=$('dlg-vs-genposes'), prog=$('dlg-vs-poseprog');
    if(_dlgPoseAbort){ _dlgPoseAbort.abort(); _dlgPoseAbort=null; if(btn){ btn.textContent='Generate poses'; btn.classList.remove('busy'); } return; }
    _dlgPoseAbort=new AbortController();
    if(btn){ btn.textContent='Stop'; btn.classList.add('busy'); }
    if(prog) prog.textContent='Starting...';
    try{
      const resp=await fetch('/api/dialogue/poses/generate',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ format:dlgVideo.format||'9:16' }), signal:_dlgPoseAbort.signal });
      const reader=resp.body.getReader(), dec=new TextDecoder(); let buf='';
      for(;;){ const {value,done}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); let idx;
        while((idx=buf.indexOf('\n\n'))>=0){ const line=buf.slice(0,idx); buf=buf.slice(idx+2); if(!line.startsWith('data:')) continue; let o; try{ o=JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
          if(o.type==='step'&&prog) prog.textContent='Generating '+o.n+'/'+o.total+' - '+o.label;
          else if(o.type==='pose'){ _dlgPoses.unshift(o.pose); _dlgRenderPoseDD(); if(prog) prog.textContent='Done '+o.n+'/'+o.total; }
          else if(o.type==='poseerr'&&prog) prog.textContent='Skip '+(o.n||'')+': '+(o.error||'failed');
          else if(o.type==='done'&&prog) prog.textContent=o.aborted?'Stopped.':('Generated '+((o.poses||[]).length)+' poses.');
          else if(o.type==='error'&&prog) prog.textContent='Error: '+o.error;
        }
      }
    }catch(e){ if(prog&&e.name!=='AbortError') prog.textContent='Error: '+e.message; }
    _dlgPoseAbort=null; if(btn){ btn.textContent='Generate poses'; btn.classList.remove('busy'); }
    await _dlgLoadPoses(); _dlgRenderPoseDD();
  }
  let _dlgEnvs=null;
  async function _dlgLoadEnvs(){ if(_dlgEnvs) return _dlgEnvs; try{ const d=await fetch('/api/gallery/environments').then(x=>x.json()); _dlgEnvs=(d&&d.files)||[]; }catch(e){ _dlgEnvs=[]; } return _dlgEnvs; }
  function _dlgVideoApplyState(){ const fmt=$('dlg-vs-format'); if(fmt) fmt.value=dlgVideo.format||'9:16'; const cam=$('dlg-vs-camera'); if(cam) cam.value=dlgVideo.camera||'iphone-wide'; const loc=$('dlg-vs-loc'); if(loc&&loc._render) loc._render(); const mir=$('dlg-vs-mirror'); if(mir) mir.checked=!!dlgVideo.mirror; if(typeof _dlgLoadPoses==='function') _dlgLoadPoses().then(_dlgRenderPoseDD); }
  // reusable thumbnail dropdown: trigger (current thumb) + popup grid of thumbnails
  function _dlgThumbDD(host, getItems, getVal, setVal, placeholder){
    function render(){ const items=getItems()||[], val=getVal(), cur=items.find(x=>String(x.id)===String(val));
      host.innerHTML=`<button class="dlg-dd-trig" type="button">${cur?`<img src="${cur.thumb}" alt="">`:''}<span class="dlg-dd-lbl">${cur?_dlgAttr(cur.label||'Selected'):_dlgAttr(placeholder)}</span><span class="dlg-dd-car">▾</span></button>`;
      host.querySelector('.dlg-dd-trig').addEventListener('click',e=>{ e.stopPropagation(); openPop(); }); }
    function openPop(){ let pop=document.getElementById('dlg-dd-pop'); if(pop) pop.remove();
      const items=getItems()||[]; pop=document.createElement('div'); pop.id='dlg-dd-pop'; pop.className='dlg-dd-pop';
      pop.innerHTML=items.length?items.map(it=>`<button class="dlg-dd-it${String(it.id)===String(getVal())?' sel':''}" type="button" data-id="${_dlgAttr(it.id)}" title="${_dlgAttr(it.label||'')}"><img src="${it.thumb}" alt="">${it.label?`<span>${_dlgAttr(it.label)}</span>`:''}</button>`).join(''):'<div class="notice" style="padding:6px 8px">none</div>';
      (document.getElementById('l1-scenarii-v2')||document.body).appendChild(pop);
      // width = the Video setup column; open UPWARD; never above the column header; scroll if tall
      const colEl=host.closest('#dlg-video')||host.closest('.dlg-col'); const colR=colEl?colEl.getBoundingClientRect():host.getBoundingClientRect();
      const headEl=colEl?colEl.querySelector('.dlg-head'):null; const headBottom=headEl?headEl.getBoundingClientRect().bottom:colR.top;
      const trigR=host.querySelector('.dlg-dd-trig').getBoundingClientRect();
      pop.style.left=Math.round(colR.left)+'px'; pop.style.width=Math.round(colR.width)+'px';
      pop.style.top='auto'; pop.style.bottom=Math.round((window.innerHeight||800)-(trigR.top-4))+'px';
      pop.style.maxHeight=Math.max(120,Math.round((trigR.top-4)-(headBottom+6)))+'px';
      const close=()=>{ try{ pop.remove(); }catch(e){} document.removeEventListener('mousedown',onDoc,true); };
      const onDoc=e=>{ if(!pop.contains(e.target)) close(); };
      setTimeout(()=>document.addEventListener('mousedown',onDoc,true),0);
      pop.querySelectorAll('.dlg-dd-it').forEach(b=>b.addEventListener('click',()=>{ setVal(b.dataset.id); close(); render(); _dlgAutosave(); }));
    }
    host._render=render; render();
  }
  // cast row: host & guest side by side (blue/red); click the thumb -> photoshoot flyout
  // (or the model picker if the role is empty); "+ new photoshoot" is a stub for now.
  function renderVideoCast(){
    const box=$('dlg-vs-cast'); if(!box) return;
    const chars=[['host','Host'],['guest','Guest']].map(([sp,def])=>{
      const rm=_dlgRoleModel(sp);
      const slot = rm
        ? `<img class="dlg-vs-av" src="${rm.frame}" data-role="${sp}" alt="" title="${_dlgAttr(rm.name||def)} - change photoshoot">`
        : `<button class="dlg-vs-add" type="button" data-role="${sp}" title="Assign ${def}">+</button>`;
      return `<div class="dlg-vs-char ${sp}"><div class="dlg-vs-tag">${def}</div>${slot}<div class="dlg-vs-nm">${rm?_dlgAttr(rm.name||''):'&mdash;'}</div><button class="dlg-vs-newshoot" type="button" data-role="${sp}" title="Generate a new photoshoot (coming soon)">+ new photoshoot</button></div>`;
    }).join('');
    // 3rd slot: "Both" = the composited interview mix (host+guest on the colour-anchor pose + location)
    const pool=dlgVideo.bothPool||[]; const active=pool[dlgVideo.bothIdx]||null; const busy=!!_dlgBothAbort;
    const ready=!!(_dlgRoleModel('host')&&_dlgRoleModel('guest')&&dlgVideo.pose);
    const both=`<div class="dlg-vs-char both"><div class="dlg-vs-tag">Both</div>`+
      (active?`<img class="dlg-vs-av dlg-vs-bothimg" src="${active.thumb||active.file}" data-full="${_dlgAttr(active.file||'')}" alt="" title="Click to enlarge">`:`<div class="dlg-vs-ph">interview<br>mix</div>`)+
      (pool.length>1?`<div class="dlg-vs-poolnav"><button class="dlg-bp-prev" type="button" title="Prev">&lsaquo;</button><span>${dlgVideo.bothIdx+1}/${pool.length}</span><button class="dlg-bp-next" type="button" title="Next">&rsaquo;</button></div>`:`<div class="dlg-vs-nm">&mdash;</div>`)+
      `<button class="dlg-vs-bothgen${busy?' busy':''}" id="dlg-vs-bothgen" type="button"${(busy||ready)?'':' disabled'}>${busy?'Stop':'Generate'}</button></div>`;
    box.innerHTML=chars+both;
    box.querySelectorAll('.dlg-vs-av').forEach(im=>{ if(im.classList.contains('dlg-vs-bothimg')) return; im.addEventListener('click',e=>{ e.stopPropagation(); _dlgVsPickPhoto(im.dataset.role,im); }); });
    box.querySelectorAll('.dlg-vs-add').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); openRolePicker(b.dataset.role,b); }));
    box.querySelectorAll('.dlg-vs-newshoot').forEach(b=>b.addEventListener('click',()=>{ const st=$('dlg-vs-poseprog'); if(st) st.textContent='New-photoshoot generator - coming soon.'; }));
    const bi=box.querySelector('.dlg-vs-bothimg'); if(bi) bi.addEventListener('click',e=>{ e.stopPropagation(); _dlgLightbox(bi.dataset.full); });
    const bg=box.querySelector('#dlg-vs-bothgen'); if(bg) bg.addEventListener('click', _dlgGenBoth);
    const bp=box.querySelector('.dlg-bp-prev'), bn=box.querySelector('.dlg-bp-next');
    if(bp) bp.addEventListener('click',()=>{ if(dlgVideo.bothIdx>0){ dlgVideo.bothIdx--; dlgVideo.both=(dlgVideo.bothPool[dlgVideo.bothIdx]||{}).file||null; renderVideoCast(); _dlgAutosave(); } });
    if(bn) bn.addEventListener('click',()=>{ if(dlgVideo.bothIdx<((dlgVideo.bothPool||[]).length-1)){ dlgVideo.bothIdx++; dlgVideo.both=(dlgVideo.bothPool[dlgVideo.bothIdx]||{}).file||null; renderVideoCast(); _dlgAutosave(); } });
    _dlgUpdateGenPosesGate();
    if(_dlgBothBusyProj && _dlgBothBusyProj===_dlgCurProject){ const sl=box.querySelector('.dlg-vs-char.both'); if(sl) sl.classList.add('busy'); }   // keep Both blur/pulse across cast re-render
  }
  function _dlgUpdateGenPosesGate(){ const b=$('dlg-vs-genposes'); if(b && !_dlgPoseAbort) b.disabled=!((dlgVideo.bothPool||[]).length); }
  function _dlgLightbox(src){ if(!src) return; const ex=document.getElementById('dlg-lightbox'); if(ex) ex.remove(); const lb=document.createElement('div'); lb.id='dlg-lightbox'; lb.className='dlg-lightbox'; const isVid=/\.(mp4|webm|mov)(\?|$)/i.test(src); lb.innerHTML= isVid ? `<video src="${_dlgAttr(src)}" controls autoplay loop playsinline></video>` : `<img src="${_dlgAttr(src)}" alt="">`; (document.getElementById('l1-scenarii-v2')||document.body).appendChild(lb); const close=()=>{ try{ lb.remove(); }catch(e){} document.removeEventListener('keydown',onKey,true); }; lb.addEventListener('click',e=>{ if(e.target===lb) close(); }); const onKey=e=>{ if(e.key==='Escape') close(); }; document.addEventListener('keydown',onKey,true); }
  let _dlgBothAbort=null;
  async function _dlgGenBoth(){
    if(_dlgBothAbort){ _dlgBothAbort.abort(); _dlgBothAbort=null; _dlgBothBusy(false); renderVideoCast(); return; }
    const host=_dlgRoleModel('host'), guest=_dlgRoleModel('guest'), prog=$('dlg-vs-poseprog');
    if(!host||!guest||!dlgVideo.pose){ if(prog) prog.textContent='Pick host, guest and a pose first.'; return; }
    const projId=_dlgCurProject;   // persists to THIS project even if the user switches away
    _dlgBothAbort=new AbortController(); renderVideoCast(); _dlgBothBusy(true);   // blur+pulse Both slot + rotate phrases under Generate poses
    let _dlgBothMsg='', _bothImage=null;
    const camSpec=(DLG_CAMERAS.find(c=>c.id===dlgVideo.camera)||{}).spec||'';
    try{
      const resp=await fetch('/api/dialogue/both/generate',{ method:'POST', headers:{'Content-Type':'application/json'}, signal:_dlgBothAbort.signal, body:JSON.stringify({ format:dlgVideo.format||'9:16', location:dlgVideo.location||null, cameraSpec:camSpec, engine:dlgVideo.engine||'nano-banana-2', engineParams:dlgVideo.engineParams||{}, mirror:!!dlgVideo.mirror, poseId:dlgVideo.pose, hostFrame:host.frame, guestFrame:guest.frame, twoStep:!!dlgVideo.bothTwoStep }) });
      const reader=resp.body.getReader(), dec=new TextDecoder(); let buf='';
      for(;;){ const {value,done}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); let idx;
        while((idx=buf.indexOf('\n\n'))>=0){ const line=buf.slice(0,idx); buf=buf.slice(idx+2); if(!line.startsWith('data:')) continue; let o; try{ o=JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
          if(o.type==='done'&&o.image){ _bothImage=o.image; _dlgBothMsg='Both: ready.'; }
          else if(o.type==='error'){ _dlgBothMsg='Both: '+o.error; }
        }
      }
    }catch(e){ if(e.name!=='AbortError') _dlgBothMsg='Both: '+e.message; }
    _dlgBothAbort=null; _dlgBothBusy(false);
    if(_bothImage){ if(_dlgCurProject===projId){ dlgVideo.bothPool=dlgVideo.bothPool||[]; dlgVideo.bothPool.push(_bothImage); dlgVideo.bothIdx=dlgVideo.bothPool.length-1; dlgVideo.both=_bothImage.file; renderVideoCast(); _dlgAutosave(); } else { _dlgPersistBoth(projId,_bothImage); } }
    else if(_dlgCurProject===projId) renderVideoCast();
    if(prog&&_dlgBothMsg&&_dlgCurProject===projId) prog.textContent=_dlgBothMsg;
  }
  async function _dlgPersistBoth(projId, image){
    if(!projId||projId==='_') return;
    try{ const r=await fetch(DLG_API_PROJ+'/get?id='+encodeURIComponent(projId)).then(x=>x.json()); const p=r&&r.project; if(!p) return; const d=p.data||{};
      d.video=d.video||{}; d.video.bothPool=Array.isArray(d.video.bothPool)?d.video.bothPool:[]; d.video.bothPool.push(image); d.video.bothIdx=d.video.bothPool.length-1; d.video.both=image.file;
      await fetch(DLG_API_PROJ+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:projId,name:p.name,data:d})});
    }catch(e){}
  }
  let _dlgBothPhraseT=null, _dlgBothBusyProj=null;
  function _dlgBothBusy(on){
    const cast=$('dlg-vs-cast'); const slot=cast?cast.querySelector('.dlg-vs-char.both'):null; const prog=$('dlg-vs-poseprog');
    if(on){ _dlgBothBusyProj=_dlgCurProject; if(slot) slot.classList.add('busy'); if(prog){ prog.classList.add('bright'); const rot=()=>{ prog.textContent=DLG_VIDEO_PHRASES[Math.floor(Math.random()*DLG_VIDEO_PHRASES.length)]; }; rot(); clearInterval(_dlgBothPhraseT); _dlgBothPhraseT=setInterval(rot,2500); } }
    else { _dlgBothBusyProj=null; if(slot) slot.classList.remove('busy'); clearInterval(_dlgBothPhraseT); _dlgBothPhraseT=null; if(prog) prog.classList.remove('bright'); }
  }
  function _dlgVsPickPhoto(speaker,anchor){ const id=(speaker==='guest')?dlgActive[1]:dlgActive[0]; if(!id){ openRolePicker(speaker,anchor); return; } showFlyout(id,anchor,{onPick:(frame)=>{ setRoleModel(speaker,id,frame); }}); }
  // ── Q2: dialogue generator (two-pass: Gemini clean -> Hermes recolor) ─────────
  const DLG_THEME='marketing';
  let dlgClean=[], dlgColored=[], dlgView='colored', dlgViewMode='pairs';   // dlgViewMode: 'pairs' (2/row) | 'rows' (1/row)
  let dlgRoleName={host:'Host', guest:'Guest'};   // editable role names from the cast pills -> generation
  let dlgReuseHint={host:null, guest:null};   // reuse mode: {gender, role} hint per role until a new character is picked
  let dlgVideo={ format:'9:16', mirror:false, pose:null, location:null, both:null, bothPool:[], bothIdx:-1, bothTwoStep:false, engine:'nano-banana-2', engineParams:{}, camera:'iphone-wide', seedTiming:'words', seedImprove:true, resolution:'480p', nsfw:false };   // Video setup state (saved in the project); bothPool = composited interview-mix variants
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
        <label class="fld" style="flex:0 0 70px;min-width:0"><span>Lines</span><input id="dlg-lines" type="number" min="2" max="14" value="6"></label>
        <label class="fld"><span>Line length</span><select id="dlg-length">
          <option value="">auto</option>
          <option value="about 4-6 words (~2-3 seconds spoken)">Short ~5w (2-3s)</option>
          <option value="about 10-12 words (~5 seconds spoken)" selected>Medium ~11w (5s)</option>
          <option value="about 18-22 words (~9 seconds spoken)">Long ~20w (9s)</option>
          <option value="about 28-32 words (~13 seconds spoken)">Very long ~30w (13s)</option>
        </select></label>
        <button class="primary" id="dlg-gen" style="margin-left:auto">▶ Generate</button>
      </div>
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
  function _dlgGenderIcon(g){ g=String(g||'').toLowerCase(); return g==='male'?'♂':g==='female'?'♀':(g?'⚧':''); }
  function _dlgAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function renderCastPills(){
    const box=$('dlg-cast'); if(!box) return;
    box.innerHTML=[['host','Host'],['guest','Guest']].map(([sp,def])=>{
      const rm=_dlgRoleModel(sp), hint=dlgReuseHint[sp];
      const gender = rm ? _dlgRoleGender(sp) : (hint?hint.gender:'');
      const glab = gender ? `<span class="dlg-castpill-gender g-${String(gender).toLowerCase()}" title="${gender}">${_dlgGenderIcon(gender)}</span>` : '';
      const av = rm
        ? `<img class="dlg-castpill-th" src="${rm.frame}" data-role="${sp}" title="${_dlgAttr(rm.name||def)} - click to change" alt="">`
        : `<button class="dlg-castpill-add${hint?' hint':''}" type="button" data-role="${sp}" title="${hint&&gender?('Pick a '+gender+' character (reused script)'):('Assign '+def)}">+</button>`;
      const val=(dlgRoleName[sp]||def).replace(/"/g,'&quot;');
      return `<div class="dlg-castpill${(!rm&&hint)?' reuse-hint':''}" data-role="${sp}">${av}<span class="dlg-castpill-tag">${def}</span>${glab}<input class="dlg-castpill-role" type="text" data-role="${sp}" value="${val}" placeholder="${def} role (e.g. doctor)"></div>`;
    }).join('');
    box.querySelectorAll('.dlg-castpill-role').forEach(inp=>inp.addEventListener('input',()=>{ dlgRoleName[inp.dataset.role]=inp.value; _dlgAutosave(); }));
    box.querySelectorAll('.dlg-castpill-th,.dlg-castpill-add').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); openRolePicker(b.dataset.role,b); }));   // assign / replace cast in the Dialogue column
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
    return { product:$('dlg-topic').value, includeProduct:$('dlg-include').checked, vertical:$('dlg-vertical').value, source:$('dlg-source').value, tone:$('dlg-tone').value, taboo:$('dlg-taboo').value, lines:$('dlg-lines').value, length:($('dlg-length')||{}).value||'',
      viewMode:dlgViewMode, view:dlgView, video:dlgVideo, roles:{host:dlgRoleName.host,guest:dlgRoleName.guest},
      cast:{ host:dlgActive[0]?{id:dlgActive[0],frame:dlgFrame[dlgActive[0]]||'',gender:_dlgRoleGender('host'),role:dlgRoleName.host}:null, guest:dlgActive[1]?{id:dlgActive[1],frame:dlgFrame[dlgActive[1]]||'',gender:_dlgRoleGender('guest'),role:dlgRoleName.guest}:null },
      clean:dlgClean, colored:dlgColored };
  }
  async function saveCurrentProject(){
    const data=_dlgSnapshot(); const prod=String(data.product||'').trim();
    let date=''; try{ date=new Date().toISOString().slice(0,10); }catch(e){}
    const name=(date?date+' - ':'')+(prod?prod.slice(0,42):'dialogue');
    // include id so an already-created project is UPDATED, not duplicated; omit it (-> new) only on first save
    try{ const r=await fetch(DLG_API_PROJ+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:_dlgCurProject||undefined,name,data})}).then(x=>x.json());
      if(r&&r.project){ _dlgCurProject=r.project.id; await loadProjectsList(r.project.id); } }catch(e){}
  }
  let _dlgSaveT=null;
  function _dlgAutosave(){ if(!_dlgCurProject) return; clearTimeout(_dlgSaveT); _dlgSaveT=setTimeout(()=>{ if(_dlgCurProject) saveCurrentProject(); },700); }   // edits update the loaded project
  async function loadProject(id){
    if(!id) return;
    try{ const r=await fetch(DLG_API_PROJ+'/get?id='+encodeURIComponent(id)).then(x=>x.json()); const p=r&&r.project; if(!p) return; const d=p.data||{};
      _dlgCurProject=id; dlgReuseHint={host:null,guest:null};   // full load = real cast, no hints
      $('dlg-topic').value=d.product||''; $('dlg-include').checked=d.includeProduct!==false;
      $('dlg-tone').value=d.tone||''; $('dlg-taboo').value=d.taboo||'spicy'; $('dlg-lines').value=d.lines||6; if($('dlg-length')) $('dlg-length').value=d.length||'';
      if(d.vertical){ $('dlg-vertical').value=d.vertical; await loadDlgSources(); if(d.source) $('dlg-source').value=d.source; }
      dlgRoleName={ host:(d.roles&&d.roles.host)||'Host', guest:(d.roles&&d.roles.guest)||'Guest' };
      dlgActive=[ d.cast&&d.cast.host?String(d.cast.host.id):null, d.cast&&d.cast.guest?String(d.cast.guest.id):null ];
      if(d.cast&&d.cast.host&&d.cast.host.frame) dlgFrame[String(d.cast.host.id)]=d.cast.host.frame;
      if(d.cast&&d.cast.guest&&d.cast.guest.frame) dlgFrame[String(d.cast.guest.id)]=d.cast.guest.frame;
      dlgClean=Array.isArray(d.clean)?d.clean:[]; dlgColored=Array.isArray(d.colored)?d.colored:dlgClean;
      dlgViewMode=(d.viewMode==='rows')?'rows':'pairs'; dlgView=(d.view==='clean')?'clean':'colored';
      dlgVideo=Object.assign({format:'9:16',mirror:false,pose:null,location:null,both:null,bothPool:[],bothIdx:-1,bothTwoStep:false,engine:'nano-banana-2',engineParams:{},camera:'iphone-wide',seedTiming:'words',seedImprove:true,resolution:'480p',nsfw:false}, d.video||{}); _dlgVideoApplyState();
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
  // "New scenario" -> popdown: reuse a saved script (new cast) OR start fresh
  function _dlgNewMenu(anchor){
    let ov=document.getElementById('dlgNewMenu'); if(ov){ ov.remove(); return; }
    ov=document.createElement('div'); ov.id='dlgNewMenu'; ov.className='dlg-newmenu';
    ov.innerHTML='<button id="dnm-reuse" type="button">Reuse a saved script (new cast &amp; voices)</button><button id="dnm-fresh" type="button">Start from scratch</button>';
    (document.getElementById('l1-scenarii-v2')||document.body).appendChild(ov);
    const rb=anchor.getBoundingClientRect(); ov.style.top=(rb.bottom+4)+'px'; ov.style.left=rb.left+'px';
    const close=()=>{ try{ ov.remove(); }catch(e){} document.removeEventListener('mousedown',onDoc,true); };
    const onDoc=e=>{ if(!ov.contains(e.target) && e.target!==anchor) close(); };
    setTimeout(()=>document.addEventListener('mousedown',onDoc,true),0);
    ov.querySelector('#dnm-fresh').onclick=()=>{ close(); _dlgResetWorkspace(); };
    ov.querySelector('#dnm-reuse').onclick=()=>{ close(); _dlgReusePicker(anchor); };
  }
  function _dlgResetWorkspace(){
    _dlgCurProject=null;
    $('dlg-topic').value=''; $('dlg-include').checked=true; $('dlg-tone').value=''; $('dlg-taboo').value='spicy'; $('dlg-lines').value=6; if($('dlg-length')) $('dlg-length').selectedIndex=2;
    dlgRoleName={host:'Host',guest:'Guest'}; dlgActive=[null,null]; dlgReuseHint={host:null,guest:null}; dlgVideo={format:'9:16',mirror:false,pose:null,location:null,both:null,bothPool:[],bothIdx:-1,bothTwoStep:false,engine:'nano-banana-2',engineParams:{},camera:'iphone-wide',seedTiming:'words',seedImprove:true,resolution:'480p',nsfw:false}; if(typeof _dlgApplyDefaults==='function') _dlgApplyDefaults(); _dlgVideoApplyState();
    dlgClean=[]; dlgColored=[]; dlgView='colored'; dlgViewMode='pairs';
    const cc=$('dlg-cc-tog'); if(cc) cc.checked=true; const vt=$('dlg-view-tog'); if(vt) vt.checked=false;
    const dd=$('dlg-project'); if(dd) dd.value='';
    renderActive(); renderDlgScenario();
    const st=$('dlg-status'); if(st) st.textContent='New scenario - pick characters and generate.';
  }
  async function _dlgReusePicker(anchor){
    let list=[]; try{ list=(await fetch(DLG_API_PROJ).then(x=>x.json())).projects||[]; }catch(e){}
    let ov=document.getElementById('dlgNewMenu'); if(ov) ov.remove();
    ov=document.createElement('div'); ov.id='dlgNewMenu'; ov.className='dlg-newmenu';
    ov.innerHTML='<div class="dlg-newmenu-h">Reuse which script?</div>'+(list.length?list.map(p=>`<button type="button" data-id="${p.id}">${String(p.name||p.id).replace(/</g,'&lt;')}</button>`).join(''):'<div class="notice" style="padding:6px 8px">No saved projects.</div>');
    (document.getElementById('l1-scenarii-v2')||document.body).appendChild(ov);
    const rb=anchor.getBoundingClientRect(); ov.style.top=(rb.bottom+4)+'px'; ov.style.left=rb.left+'px';
    const close=()=>{ try{ ov.remove(); }catch(e){} document.removeEventListener('mousedown',onDoc,true); };
    const onDoc=e=>{ if(!ov.contains(e.target)) close(); };
    setTimeout(()=>document.addEventListener('mousedown',onDoc,true),0);
    ov.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',async()=>{ close(); await _dlgReuseScript(b.dataset.id); }));
  }
  // build a {gender, role} hint from a saved cast slot (gender from saved field, else derive from the model)
  function _reuseHint(cast, role){ if(!cast) return null; let g=cast.gender||''; if(!g && cast.id){ const m=_dlgModels.find(x=>String(x.id)===String(cast.id)); if(m) g=m.gender||''; } return { gender:String(g||'').toLowerCase(), role:role||'' }; }
  async function _dlgReuseScript(id){
    try{ const r=await fetch(DLG_API_PROJ+'/get?id='+encodeURIComponent(id)).then(x=>x.json()); const p=r&&r.project; if(!p) return; const d=p.data||{};
      _dlgCurProject=null;   // new scenario: reuse text only, cast cleared for new (gender-matched) characters/voices
      $('dlg-topic').value=d.product||''; $('dlg-tone').value=d.tone||''; $('dlg-taboo').value=d.taboo||'spicy'; $('dlg-lines').value=d.lines||6; if($('dlg-length')) $('dlg-length').value=d.length||'';
      if(d.vertical){ $('dlg-vertical').value=d.vertical; await loadDlgSources(); if(d.source) $('dlg-source').value=d.source; }
      dlgClean=Array.isArray(d.clean)?d.clean:[]; dlgColored=Array.isArray(d.colored)?d.colored:dlgClean;
      const rh=(d.roles&&d.roles.host)||(d.cast&&d.cast.host&&d.cast.host.role)||'Host';
      const rg=(d.roles&&d.roles.guest)||(d.cast&&d.cast.guest&&d.cast.guest.role)||'Guest';
      dlgRoleName={host:rh,guest:rg}; dlgActive=[null,null];
      dlgReuseHint={ host:_reuseHint(d.cast&&d.cast.host, rh), guest:_reuseHint(d.cast&&d.cast.guest, rg) };
      dlgView=(d.view==='clean')?'clean':'colored'; dlgViewMode=(d.viewMode==='rows')?'rows':'pairs';
      const cc=$('dlg-cc-tog'); if(cc) cc.checked=(dlgView==='colored'); const vt=$('dlg-view-tog'); if(vt) vt.checked=(dlgViewMode==='rows');
      const dd=$('dlg-project'); if(dd) dd.value='';
      renderActive(); renderDlgScenario();
      const st=$('dlg-status'); if(st) st.textContent='Reusing script - pick new characters (gender locked to the script), then voice them.';
    }catch(e){}
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
    const cc=$('dlg-cc-tog'); if(cc) cc.addEventListener('change',()=>{ dlgView=cc.checked?'colored':'clean'; renderDlgScenario(); _dlgAutosave(); });
    const vt=$('dlg-view-tog'); if(vt) vt.addEventListener('change',()=>{ dlgViewMode=vt.checked?'rows':'pairs'; renderDlgScenario(); _dlgAutosave(); });
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
  function _dlgFmtTags(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\[([^\]]*)\]/g,'<span class="dlg-tag">[$1]</span>'); }
  function _dlgFmtDur(sec){ sec=Math.max(0,Math.round(sec||0)); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); }
  function _dlgAudioDuration(path){ return new Promise(res=>{ try{ const a=new Audio(); a.preload='metadata'; a.addEventListener('loadedmetadata',()=>res(a.duration||0)); a.addEventListener('error',()=>res(0)); a.src=path; }catch(e){ res(0); } }); }
  // caret save/restore so re-highlighting on input keeps the cursor in place
  function _dlgCaretOffset(el){ const sel=window.getSelection&&window.getSelection(); if(!sel||!sel.rangeCount) return null; const r=sel.getRangeAt(0); if(!el.contains(r.endContainer)) return null; const pre=r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.endContainer,r.endOffset); return pre.toString().length; }
  function _dlgSetCaret(el,pos){ if(pos==null) return; const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null); let node=null,acc=0,cur; while((cur=w.nextNode())){ const len=cur.nodeValue.length; if(acc+len>=pos){ node=cur; pos=pos-acc; break; } acc+=len; } try{ const r=document.createRange(); if(node){ r.setStart(node,Math.min(pos,node.nodeValue.length)); } else { r.selectNodeContents(el); r.collapse(false); } r.collapse(true); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }catch(e){} }
  function _dlgSpeakerHtml(speaker){
    const rm=_dlgRoleModel(speaker), role=speaker==='guest'?'Guest':'Host';
    const id=speaker==='guest'?dlgActive[1]:dlgActive[0];
    const av = rm
      ? `<img class="dlg-av" src="${rm.frame}" data-role="${speaker}" title="${_dlgAttr(rm.name||role)} - click to change">`
      : `<button class="dlg-av-add" type="button" data-role="${speaker}" title="Assign ${role}">+</button>`;
    const noVoice = rm && id && _dlgVoicesReady && !_dlgHasVoiceSync(id)
      ? `<button class="dlg-novoice" type="button" data-char="${_dlgAttr(id)}" title="This character has no linked voice - click to create one">no voice</button>` : '';
    return `<div class="dlg-card-spk">${av}<span class="dlg-card-who">${role}</span>${noVoice}</div>`;
  }
  // card action buttons: valid audio -> duration + play; text changed since voicing (dirty) ->
  // reset + a glowing voice (re-voice needed); no audio -> just voice.
  function _dlgActsHtml(l,idx){
    const hasAudio=!!l.audio, valid=hasAudio&&l._audioText===l.text, dirty=hasAudio&&l._audioText!=null&&l._audioText!==l.text;
    let h='';
    if(valid){ if(l.audioDur) h+=`<span class="dlg-card-dur">${_dlgFmtDur(l.audioDur)}</span>`; h+=`<button class="dlg-card-play" type="button" data-idx="${idx}" title="Play / pause">▶</button>`; }
    if(dirty) h+=`<button class="dlg-card-reset" type="button" data-idx="${idx}" title="Revert text to the voiced version">↺</button>`;
    h+=`<button class="dlg-card-voice${dirty?' dirty':''}" type="button" data-idx="${idx}" title="${dirty?'Text changed - re-voice this line':'Voice this line'}">&#128266;</button>`;
    return h;
  }
  function _dlgUpdateCardActs(i){ const body=$('dlg-work-body'); if(!body) return; const tx=body.querySelector(`.dlg-card-tx[data-idx="${i}"]`); if(!tx) return; const acts=tx.closest('.dlg-card').querySelector('.dlg-card-acts'); const a=(dlgView==='clean')?dlgClean:dlgColored; if(acts&&a[i]) acts.innerHTML=_dlgActsHtml(a[i],i); }
  function _dlgResetLine(i){ const a=(dlgView==='clean')?dlgClean:dlgColored; const l=a[i]; if(!l||l._audioText==null) return; l.text=l._audioText; const body=$('dlg-work-body'); const tx=body&&body.querySelector(`.dlg-card-tx[data-idx="${i}"]`); if(tx) tx.innerHTML=_dlgFmtTags(l.text); _dlgUpdateCardActs(i); _dlgSyncPlayBtns(); _dlgAutosave(); }
  function renderDlgScenario(){
    const body=$('dlg-work-body'); if(!body) return;
    if(!_dlgVoicesReady) _dlgLoadVoices().then(()=>renderDlgScenario());   // load voices once -> re-render so "no voice" tags appear
    const lines=(dlgView==='clean')?dlgClean:dlgColored;
    if(!lines||!lines.length){ body.innerHTML='<div class="notice">Generate a dialogue to see the script here.</div>'; return; }
    const card=(l,idx)=> l ? `<div class="dlg-card ${l.speaker==='guest'?'guest':'host'}">
        <div class="dlg-card-main">
          <div class="dlg-card-h">${_dlgSpeakerHtml(l.speaker)}<span class="dlg-card-acts">${_dlgActsHtml(l,idx)}</span></div>
          <div class="dlg-card-tx" contenteditable="true" spellcheck="false" data-idx="${idx}">${_dlgFmtTags(l.text)}</div>
        </div>
        ${_dlgEpVideoHtml(l,idx)}
        <div class="dlg-card-busy"><div class="dlg-card-busy-msg"></div><div class="dlg-card-busy-eta"></div></div>
      </div>` : '';
    let html='<div class="dlg-scn '+(dlgViewMode==='rows'?'mode-rows':'mode-pairs')+'">';
    if(dlgViewMode==='rows'){ lines.forEach((l,i)=>{ html+='<div class="dlg-scn-row">'+card(l,i)+'</div>'; }); }
    else { for(let i=0;i<lines.length;i+=2){ html+='<div class="dlg-scn-row">'+card(lines[i],i)+card(lines[i+1],i+1)+'</div>'; } }
    html+='</div>';
    body.innerHTML=html; _dlgReapplyBusy();   // re-apply blur/pulse to cards still generating (survives re-render)
    const arr=()=> (dlgView==='clean')?dlgClean:dlgColored;
    body.querySelectorAll('.dlg-card-tx').forEach(el=>{
      el.addEventListener('input',()=>{ const a=arr(), i=+el.dataset.idx; if(a[i]){ a[i].text=el.textContent; } _dlgUpdateCardActs(i); _dlgAutosave();
        clearTimeout(el._hlT); el._hlT=setTimeout(()=>{ const t=a[i]?a[i].text:el.textContent; if(t.indexOf('[')<0) return; const pos=_dlgCaretOffset(el); el.innerHTML=_dlgFmtTags(t); if(pos!=null) _dlgSetCaret(el,pos); },350); });   // live-recognize typed [tags]
      el.addEventListener('blur',()=>{ const a=arr(), i=+el.dataset.idx; if(a[i]){ a[i].text=el.textContent; el.innerHTML=_dlgFmtTags(a[i].text); } });
    });
    body.querySelectorAll('.dlg-av-add,.dlg-av').forEach(b=>{ b.addEventListener('click',e=>{ e.stopPropagation(); openRolePicker(b.dataset.role,b); }); });
    if(!body._actWired){ body._actWired=true; body.addEventListener('click',e=>{   // acts buttons are rebuilt on edit -> delegate
      const t=e.target, v=t.closest&&t.closest('.dlg-card-voice'), p=t.closest&&t.closest('.dlg-card-play'), r=t.closest&&t.closest('.dlg-card-reset'), g=t.closest&&t.closest('.dlg-card-genvid'), vv=t.closest&&t.closest('.dlg-ep-vid'), nv=t.closest&&t.closest('.dlg-novoice');
      if(nv){ e.preventDefault(); e.stopPropagation(); _dlgOpenVoicePopup(nv.dataset.char); } else if(v) _dlgVoiceLine(+v.dataset.idx); else if(p) _dlgPlayPause(+p.dataset.idx); else if(r) _dlgResetLine(+r.dataset.idx); else if(g) _dlgGenEpisode(+g.dataset.idx); else if(vv){ e.preventDefault(); _dlgLightbox(vv.getAttribute('src')); }
    }); }
    _dlgSyncPlayBtns();
    if(!body._tagWired){ body._tagWired=true;   // delegated: hover a [tag] -> popup
      body.addEventListener('mouseover',e=>{ const t=e.target&&e.target.closest&&e.target.closest('.dlg-tag'); if(t) _dlgShowTagPop(t); });
      body.addEventListener('mouseout',e=>{ const t=e.target&&e.target.closest&&e.target.closest('.dlg-tag'); if(t) _dlgHideTagPop(); });
    }
  }
  // ── Phase 7: per-episode Seedance video fragment ──
  const DLG_VIDEO_PHRASES=['Rolling the cameras...','Cueing the reactions...','Teaching the mannequins to act...','Finding the best angle...','Whispering to the lens...','Cutting on the punchlines...','Directing the eyebrows...','Syncing every syllable...','Bribing the lighting...','Coaching the side-eye...','Stealing a candid moment...','Faking the chemistry...','Polishing the close-up...','Negotiating with the b-roll...','Adding a dramatic pause...','Catching the perfect blink...','Zooming for the gasp...','Warming up the host...','Calming the guest down...','Choreographing the nod...','Hunting for the money shot...','Sprinkling some charisma...','Re-rolling for the laugh...','Aligning the jawlines...','Tuning the awkward silence...','Framing the comeback...','Letting the tension breathe...','Selling the reaction...','Editing in real time...','Almost worthy of an Oscar...'];
  function _dlgEpVideoHtml(l,idx){
    const ready = !!((dlgVideo.bothPool||[]).length) && !!l.audio;
    const vid = l.video ? `<video class="dlg-ep-vid" src="${l.video}" data-idx="${idx}" preload="metadata" muted playsinline></video>` : `<div class="dlg-ep-ph">no video</div>`;
    const title = ready ? 'Generate the interview fragment for this line' : 'Generate the Both image and voice this line first';
    return `<div class="dlg-card-vid">${vid}<button class="dlg-card-genvid" type="button" data-idx="${idx}"${ready?'':' disabled'} title="${title}">&#127916; Video</button></div>`;
  }
  function _dlgCardEl(idx){ const body=$('dlg-work-body'); if(!body) return null; const tx=body.querySelector(`.dlg-card-tx[data-idx="${idx}"]`); return tx?tx.closest('.dlg-card'):null; }
  function _dlgCardMsg(idx){ const c=_dlgCardEl(idx); return c?c.querySelector('.dlg-card-busy-msg'):null; }
  // Busy registry keyed by project#idx so the blur/pulse/ETA SURVIVE re-renders (clean/colored,
  // popups, param changes) AND project switches (resumes when you switch back). One shared ticker
  // re-queries the card each ~0.9s, so a renderDlgScenario rebuild never loses the animation; the
  // generation itself (fetch/SSE) is never touched.
  let _dlgBusy={}, _dlgBusyTick=null, _dlgBusyPhase=0;
  function _dlgFmtETA(s){ s=Math.max(0,Math.round(s)); const m=Math.floor(s/60); return m? (m+':'+String(s%60).padStart(2,'0')) : (s+'s'); }
  function _dlgBusyTicker(){ _dlgBusyPhase++; const keys=Object.keys(_dlgBusy); if(!keys.length){ clearInterval(_dlgBusyTick); _dlgBusyTick=null; return; }
    keys.forEach(k=>{ const e=_dlgBusy[k]; if(e.projId!==(_dlgCurProject||'_')) return; const c=_dlgCardEl(e.idx); if(!c) return;
      if(!c.classList.contains('busy')) c.classList.add('busy');
      const msg=c.querySelector('.dlg-card-busy-msg'), eta=c.querySelector('.dlg-card-busy-eta');
      if(msg){ if(e.label) msg.textContent=e.label; else if(!msg.textContent || _dlgBusyPhase%3===0) msg.textContent=DLG_VIDEO_PHRASES[Math.floor(Math.random()*DLG_VIDEO_PHRASES.length)]; }
      if(eta){ const left=e.etaDeadline?(e.etaDeadline-Date.now())/1000:null; eta.textContent= left==null?'':(left>0?('~'+_dlgFmtETA(left)+' left'):'almost done...'); } }); }
  function _dlgReapplyBusy(){ Object.keys(_dlgBusy).forEach(k=>{ const e=_dlgBusy[k]; if(e.projId===(_dlgCurProject||'_')){ const c=_dlgCardEl(e.idx); if(c) c.classList.add('busy'); } }); }
  function _dlgCardEta(idx, seconds, projId){ const k=(projId||_dlgCurProject||'_')+'#'+idx; if(_dlgBusy[k]) _dlgBusy[k].etaDeadline=Date.now()+Math.max(1,seconds||0)*1000; }
  function _dlgCardBusy(idx,on,opts){ opts=opts||{}; const projId=opts.projId||_dlgCurProject||'_'; const k=projId+'#'+idx;
    if(on){ _dlgBusy[k]={projId,idx,label:opts.label||null,etaDeadline:opts.eta?Date.now()+opts.eta*1000:0}; if(!_dlgBusyTick) _dlgBusyTick=setInterval(_dlgBusyTicker,900); _dlgBusyTicker(); }
    else { delete _dlgBusy[k]; if(projId===(_dlgCurProject||'_')){ const c=_dlgCardEl(idx); if(c){ c.classList.remove('busy'); const m=c.querySelector('.dlg-card-busy-msg'), e2=c.querySelector('.dlg-card-busy-eta'); if(m)m.textContent=''; if(e2)e2.textContent=''; } } } }
  async function _dlgGenEpisode(idx){
    const arr=(dlgView==='clean')?dlgClean:dlgColored; const l=arr[idx]; if(!l) return;
    if(l._epAbort){ l._epAbort.abort(); l._epAbort=null; _dlgCardBusy(idx,false,{projId:l._epProj}); return; }   // click again = stop
    const projId=_dlgCurProject;   // generation persists to THIS project even if the user switches away
    if(!((dlgVideo.bothPool||[]).length)){ const m=_dlgCardMsg(idx); if(m) m.textContent='Generate the Both image first.'; return; }
    if(!l.audio){ const m=_dlgCardMsg(idx); if(m) m.textContent='Voice this line first.'; return; }
    const host=_dlgRoleModel('host'), guest=_dlgRoleModel('guest');
    const speaker=l.speaker==='guest'?'guest':'host';
    const speakerFrame=speaker==='host'?(host&&host.frame):(guest&&guest.frame);
    const listenerFrame=speaker==='host'?(guest&&guest.frame):(host&&host.frame);
    if(!speakerFrame||!listenerFrame){ const m=_dlgCardMsg(idx); if(m) m.textContent='Pick host and guest first.'; return; }
    const both=((dlgVideo.bothPool||[])[dlgVideo.bothIdx]||{}).file||dlgVideo.both;
    const camSpec=(DLG_CAMERAS.find(c=>c.id===dlgVideo.camera)||{}).spec||'';
    l._epAbort=new AbortController(); l._epProj=projId; _dlgCardBusy(idx,true,{projId});
    try{
      const resp=await fetch('/api/dialogue/episode/video',{ method:'POST', headers:{'Content-Type':'application/json'}, signal:l._epAbort.signal, body:JSON.stringify({
        text:l.text, speaker, speakerGender:_dlgRoleGender(speaker), listenerGender:_dlgRoleGender(speaker==='host'?'guest':'host'),
        both, speakerFrame, listenerFrame, audio:l.audio, audioDur:l.audioDur||7,
        location:dlgVideo.location||null, cameraSpec:camSpec, format:dlgVideo.format||'9:16',
        seedTiming:dlgVideo.seedTiming||'words', seedImprove:dlgVideo.seedImprove!==false,
        resolution:dlgVideo.resolution||'480p', nsfw:!!dlgVideo.nsfw }) });
      const reader=resp.body.getReader(), dec=new TextDecoder(); let buf='';
      for(;;){ const {value,done}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); let k;
        while((k=buf.indexOf('\n\n'))>=0){ const line=buf.slice(0,k); buf=buf.slice(k+2); if(!line.startsWith('data:')) continue; let o; try{ o=JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
          if(o.type==='eta'){ _dlgCardEta(idx, o.seconds, projId); }
          else if(o.type==='done'&&o.video){ l.video=o.video; }
          else if(o.type==='error'){ const m=_dlgCardMsg(idx); if(m) m.textContent='Error: '+o.error; await new Promise(r=>setTimeout(r,1800)); }
        }
      }
    }catch(e){ if(e.name!=='AbortError'){ const m=_dlgCardMsg(idx); if(m) m.textContent='Error: '+e.message; await new Promise(r=>setTimeout(r,1800)); } }
    l._epAbort=null; l._epProj=null; _dlgCardBusy(idx,false,{projId});
    if(_dlgCurProject===projId){ renderDlgScenario(); _dlgAutosave(); }   // still on this project -> live update
    else if(l.video){ _dlgPersistLineVideo(projId, idx, l.video); }       // switched away -> persist to the originating project
  }
  // Persist a finished fragment video to a project the user has navigated away from (so other
  // projects' generations are never lost). Loads the stored project, sets the line video, saves.
  async function _dlgPersistLineVideo(projId, idx, video){
    if(!projId || projId==='_') return;
    try{ const r=await fetch(DLG_API_PROJ+'/get?id='+encodeURIComponent(projId)).then(x=>x.json()); const p=r&&r.project; if(!p) return; const d=p.data||{};
      [d.clean,d.colored].forEach(a=>{ if(Array.isArray(a)&&a[idx]) a[idx].video=video; });
      await fetch(DLG_API_PROJ+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:projId,name:p.name,data:d})});
    }catch(e){}
  }
  // Send the ready episode fragments to Merge: build a synthetic Merge session whose cells (in
  // line order) become the MAIN track, write it into the shared edit-state, then open /merge.
  async function _dlgSendToMerge(){
    const arr=(dlgView==='clean')?dlgClean:dlgColored;
    const lines=(arr||[]).filter(l=>l&&l.video);
    if(!lines.length){ const st=$('dlg-vs-poseprog'); if(st) st.textContent='No ready fragments to send.'; alert('No ready video fragments yet - generate them first.'); return; }
    const btn=$('dlgMergeBtn'); if(btn){ btn.disabled=true; btn.textContent='🎬 ...'; }
    try{
      // Merge (creatives) times a main clip ONLY by its audioPath duration - a clip with no
      // audioPath gets dur 0 and is DROPPED (buildModel filter s.dur>0). So the clip MUST carry an
      // audio whose length = the VIDEO length. We extract the audio FROM each fragment, padded to
      // exactly the video duration -> clip = full video (no voice-length truncation) AND subtitles
      // come from the real video audio. (ugc_ad keeps its shorter TTS audioPath -> its truncation.)
      const cells=await Promise.all(lines.map(async l=>{
        let aud=null; try{ const r=await fetch('/api/dialogue/extract-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({video:l.video})}).then(x=>x.json()); aud=(r&&r.audio)||null; }catch(e){}
        return { line:(String(l.text||'').replace(/\[[^\]]*\]/g,'').trim().slice(0,80))||'fragment', videoPath:l.video, audioPath:aud };
      }));
      const sel=$('dlg-project'); let title=(sel&&sel.value&&sel.selectedOptions[0])?sel.selectedOptions[0].textContent.trim():'';
      if(!title||title.indexOf('—')>=0) title='Dialogue '+new Date().toISOString().slice(0,10);
      const key='dlg_'+(_dlgCurProject||('x'+Date.now()));
      // PUT merges sessions BY KEY (other projects untouched) - send only our key.
      const session={ title, inMerge:true, date:new Date().toISOString(), cells };
      await fetch('/api/edit-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessions:{[key]:session}})});
      try{ localStorage.setItem('mv2_mode_v1','creatives'); }catch(e){}          // force Creatives mode (not VSL)
      try{ localStorage.setItem('mergev2_last_session_v1', key); }catch(e){}
      // (Canvas resolution: 9:16 needs no hint - it matches the 1080x1920 default and is not
      //  cropped. A preset for 16:9 doesn't survive Merge's auto-subtitle write, so it's left to
      //  Merge's Advanced settings.)
      window.location.href='/merge';
    }catch(e){ if(btn){ btn.disabled=false; btn.textContent='🎬 Merge'; } alert('Merge handoff failed: '+e.message); }
  }
  // Pill click -> floating model picker. "+" (empty role): pick a character (reuse-gender-locked).
  // Filled pill: the current character is pinned at the top + highlighted, and its photoshoots
  // auto-open, so the user can switch the photoshoot OR pick a different character without getting lost.
  function openRolePicker(speaker,anchor){
    let ov=document.getElementById('dlgRolePick'); if(ov) ov.remove();
    ov=document.createElement('div'); ov.id='dlgRolePick'; ov.className='dlg-pick';
    const curId=String((speaker==='guest'?dlgActive[1]:dlgActive[0])||'');
    // reuse-gender lock only applies when assigning an EMPTY role (no current character)
    const want=(!curId && dlgReuseHint[speaker]&&dlgReuseHint[speaker].gender)?String(dlgReuseHint[speaker].gender).toLowerCase():'';
    const rowHtml=o=>`<div class="dlg-pick-row${String(o.id)===curId?' cur':''}" data-id="${o.id}"><img src="${_dlgModelImg(o)}"><span>${String(o.name||'model').replace(/</g,'&lt;')}</span>${String(o.id)===curId?'<span class="dlg-pick-badge">current</span>':''}</div>`;
    const curModel=curId?_dlgModels.find(x=>String(x.id)===curId):null;
    let html=`<div class="dlg-pick-h">${curId?'Change':'Assign'} ${speaker==='guest'?'Guest':'Host'}${want?(' — '+want+' only'):''}</div>`;
    if(curModel) html+=rowHtml(curModel);   // pin current character on top
    if(want){
      const items=_dlgModels.filter(o=>{ if(String(o.id)===curId) return false; const og=String(o.gender||'').toLowerCase(); return want==='other'?!(og==='male'||og==='female'):(og===want); });
      html+= items.length ? items.map(rowHtml).join('') : (curModel?'':'<div class="notice" style="padding:6px 8px">No '+want+' characters.</div>');
    } else {
      const byG=g=>_dlgModels.filter(o=>String(o.id)!==curId && (g==='other'?!(o.gender==='male'||o.gender==='female'):o.gender===g));
      [['male','Males'],['female','Females'],['other','Other']].forEach(([g,label])=>{ const items=byG(g); if(!items.length) return;
        html+=`<div class="dlg-pick-g">${label}</div>`+items.map(rowHtml).join(''); });
      if(!_dlgModels.length) html+='<div class="notice" style="padding:6px 8px">No models.</div>';
    }
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
      row.addEventListener('click',()=>{ setRoleModel(speaker,id,_dlgDefaultFrame(id)); close(); });
    });
    // filled pill -> immediately show the current character's photoshoots
    if(curModel){ const curRow=ov.querySelector('.dlg-pick-row.cur'); if(curRow) showFlyout(curId,curRow,{onPick:(frame)=>{ setRoleModel(speaker,curId,frame); close(); }}); }
  }
  // ── Step 4: voice-tag popup (hover a [tag] -> 32 tags / 4 groups -> click replaces) ──
  let _dlgVoiceTags=null, _tagPop=null, _tagPopT=null, _tagPopSpan=null;
  async function _dlgLoadVoiceTags(){ if(_dlgVoiceTags) return _dlgVoiceTags; try{ const d=await fetch('/api/dialogue/voice-tags').then(x=>x.json()); _dlgVoiceTags=d.groups||{}; }catch(e){ _dlgVoiceTags={}; } return _dlgVoiceTags; }
  function _dlgTagPopEl(){ if(_tagPop) return _tagPop; _tagPop=document.createElement('div'); _tagPop.className='dlg-tagpop'; _tagPop.addEventListener('mouseenter',()=>clearTimeout(_tagPopT)); _tagPop.addEventListener('mouseleave',_dlgHideTagPop); (document.getElementById('l1-scenarii-v2')||document.body).appendChild(_tagPop); return _tagPop; }
  function _dlgHideTagPop(){ clearTimeout(_tagPopT); _tagPopT=setTimeout(()=>{ if(_tagPop) _tagPop.classList.remove('on'); },200); }
  async function _dlgShowTagPop(span){
    clearTimeout(_tagPopT); _tagPopSpan=span;
    const groups=await _dlgLoadVoiceTags(); const pop=_dlgTagPopEl();
    pop.innerHTML=Object.keys(groups).map(g=>`<div class="dlg-tagpop-g">${g}</div><div class="dlg-tagpop-row">${(groups[g]||[]).map(t=>`<button type="button" class="dlg-tagpop-t" data-tag="${t}">${t}</button>`).join('')}</div>`).join('') || '<div class="notice" style="padding:6px">no tags</div>';
    pop.querySelectorAll('.dlg-tagpop-t').forEach(b=>b.addEventListener('click',()=>{ _dlgReplaceTag(_tagPopSpan,b.dataset.tag); if(_tagPop) _tagPop.classList.remove('on'); }));
    const r=span.getBoundingClientRect();
    pop.style.left=Math.max(8,Math.min(r.left,(window.innerWidth||1200)-312))+'px';
    pop.style.top=Math.min(r.bottom+4,(window.innerHeight||800)-250)+'px';
    pop.classList.add('on');
  }
  function _dlgReplaceTag(span,tag){ if(!span) return; span.textContent='['+tag+']'; const tx=span.closest('.dlg-card-tx'); if(tx){ const a=(dlgView==='clean')?dlgClean:dlgColored; const i=+tx.dataset.idx; if(a[i]){ a[i].text=tx.textContent; _dlgUpdateCardActs(i); } } _dlgAutosave(); }

  // ── Step 5: TTS (ElevenLabs v3, voice taken from the bound character) ──────
  let _dlgVoices=null, _dlgAudioEl=null, _dlgVoicesReady=false;
  async function _dlgLoadVoices(){ if(_dlgVoices) return _dlgVoices; try{ const d=await fetch('/api/audio/custom-voices').then(x=>x.json()); _dlgVoices=(d&&d.voices)||[]; }catch(e){ _dlgVoices=[]; } _dlgVoicesReady=true; return _dlgVoices; }
  function _dlgHasVoiceSync(charId){ if(!charId) return false; const list=_dlgVoices||window.ELEVENLABS_VOICES||[]; return list.some(v=>String(v.characterId)===String(charId)); }
  async function _dlgCharVoice(charId){ if(!charId) return null; const list=await _dlgLoadVoices(); const hit=list.find(v=>String(v.characterId)===String(charId)); return hit?(hit.voiceId||hit.name):null; }
  // "no voice" tag -> reuse the Character tab's actor popup (voice generation) for this character,
  // then refresh the voice catalog + re-render when the popup closes so the tag clears.
  function _dlgOpenVoicePopup(charId){
    if(!charId) return;
    if(typeof window.openCharacterActorPopup!=='function'){ const st=$('dlg-status'); if(st) st.textContent='Open the Character tab to add a voice.'; return; }
    window.openCharacterActorPopup(charId);
    const t=setInterval(()=>{ if(!document.getElementById('actor-popup-overlay')){ clearInterval(t); _dlgVoices=null; _dlgLoadVoices().then(()=>{ if(window.loadCustomVoices) try{ window.loadCustomVoices(); }catch(e){} renderDlgScenario(); renderCastPills&&renderCastPills(); }); } }, 800);
  }
  function _dlgEnsureAudio(){ if(_dlgAudioEl) return _dlgAudioEl; _dlgAudioEl=new Audio(); ['play','pause','ended'].forEach(ev=>_dlgAudioEl.addEventListener(ev,_dlgSyncPlayBtns)); return _dlgAudioEl; }
  function _dlgPlay(path){ try{ const a=_dlgEnsureAudio(); a.src=path; a.play().catch(()=>{}); }catch(e){} }
  function _dlgPlayPause(i){ const arr=(dlgView==='clean')?dlgClean:dlgColored; const l=arr[i]; if(!l||!l.audio) return; const a=_dlgEnsureAudio();
    if(a.src && a.src.indexOf(l.audio)>=0 && !a.paused){ a.pause(); } else { a.src=l.audio; a.play().catch(()=>{}); } _dlgSyncPlayBtns(); }
  function _dlgSyncPlayBtns(){ const body=$('dlg-work-body'); if(!body) return; const a=_dlgAudioEl; const arr=(dlgView==='clean')?dlgClean:dlgColored;
    body.querySelectorAll('.dlg-card-play').forEach(b=>{ const l=arr[+b.dataset.idx]; const playing=!!(a&&l&&l.audio&&a.src&&a.src.indexOf(l.audio)>=0&&!a.paused); b.textContent=playing?'⏸':'▶'; b.classList.toggle('playing',playing); }); }
  async function _dlgVoiceGen(i){
    const arr=(dlgView==='clean')?dlgClean:dlgColored; const l=arr[i]; if(!l) return null;
    if(l.audio && l._audioText===l.text) return l.audio;   // cached, text unchanged
    const slot=(l.speaker==='guest')?1:0; const charId=dlgActive[slot];
    const voice=await _dlgCharVoice(charId);
    if(!voice){ const st=$('dlg-status'); if(st) st.textContent=`No voice linked to the ${l.speaker} character. Add one in the Character tab.`; return null; }
    try{ const r=await fetch('/api/audio/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ text:l.text, voice, model:'elevenlabs', ttsParams:{ model_id:'eleven_v3' } })}).then(x=>x.json());
      if(r&&r.success&&r.audioPath){ l.audio=r.audioPath; l._audioText=l.text; try{ l.audioDur=await _dlgAudioDuration(r.audioPath); }catch(e){} return r.audioPath; }
      throw new Error((r&&r.error)||'tts failed');
    }catch(e){ const st=$('dlg-status'); if(st) st.textContent='Voice error: '+(e.message||e); return null; }
  }
  async function _dlgVoiceLine(i){
    const projId=_dlgCurProject;
    _dlgCardBusy(i,true,{projId,label:'Voicing...'});
    const path=await _dlgVoiceGen(i);
    _dlgCardBusy(i,false,{projId});
    if(path){ renderDlgScenario(); _dlgPlay(path); if(_dlgCurProject) saveCurrentProject(); }
  }
  async function _dlgVoiceAll(){
    const arr=(dlgView==='clean')?dlgClean:dlgColored; if(!arr.length) return;
    const st=$('dlg-status'), ga=$('dlg-voice-all'); if(ga) ga.disabled=true;
    let ok=0;
    const projId=_dlgCurProject;
    for(let i=0;i<arr.length;i++){ if(st) st.textContent=`Voicing ${i+1}/${arr.length}…`; _dlgCardBusy(i,true,{projId,label:'Voicing...'}); const p=await _dlgVoiceGen(i); _dlgCardBusy(i,false,{projId}); if(p){ ok++; renderDlgScenario(); } }   // blur+pulse the current line; show each play button as it arrives
    if(ga) ga.disabled=false; if(st) st.textContent=`Voiced ${ok}/${arr.length} lines.`;
    if(_dlgCurProject) saveCurrentProject();
  }
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
    _dlgCollapseModels();   // free space for the script while generating
    const st=$('dlg-status'); if(st) st.textContent='';
    const rl=$('dlg-runlog'); if(rl){ rl.style.display='none'; rl.textContent=''; }
    _dlgLoader(); _dlgStartPhrases();
    let buf='', got=false;
    try{
      const resp=await fetch('/api/dialogue/script',{method:'POST',headers:{'Content-Type':'application/json'},signal:_dlgAbort.signal,body:JSON.stringify({
        topic:$('dlg-topic').value, product:$('dlg-topic').value, includeProduct:$('dlg-include').checked,
        hostRole:(dlgRoleName.host||'Host'), guestRole:(dlgRoleName.guest||'Guest'),
        hostGender:_dlgRoleGender('host'), guestGender:_dlgRoleGender('guest'), lines:$('dlg-lines').value, length:($('dlg-length')||{}).value||'',
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
    #l1-scenarii-v2 #dlg-models{flex:0 1 280px;min-width:200px;order:10}
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
    #l1-scenarii-v2 #dlg-script{flex:0 1 340px;min-width:240px;order:11}
    #l1-scenarii-v2 #dlg-video{flex:0 1 510px;min-width:300px;order:12}
    #l1-scenarii-v2 #dlg-work{flex:1 1 0;min-width:0;order:13}
    /* dialogues fills the panel: FULL WIDTH (no centering) + full height with an outer gap.
       #pl-dialogues stays a flex ITEM of #s2-root (flex:1); height flows via .wrap height:100% */
    #l1-scenarii-v2 #pl-dialogues{overflow:hidden}
    #l1-scenarii-v2 #pl-dialogues .wrap{max-width:none;width:auto;margin:0;box-sizing:border-box;padding:14px 20px 0}
    #l1-scenarii-v2 #dlg-cols{display:flex;min-height:0}   /* height set to the viewport via _dlgFitHeight() */
    #l1-scenarii-v2 .dlg-col{height:100%;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--surface) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-lg) !important;padding:12px !important}
    #l1-scenarii-v2 .dlg-col>.dlg-head{flex:0 0 auto}
    #l1-scenarii-v2 .dlg-col>.dlg-body{flex:1 1 auto;min-height:0;overflow:auto}
    /* title bars use the midnight surface tokens (match the header rows), not bright navy */
    #l1-scenarii-v2 .dlg-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 0 10px;padding:7px 11px;background:var(--surface-2);border:1px solid var(--border-soft);border-radius:var(--r-sm)}
    #l1-scenarii-v2 .dlg-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);font-weight:650}
    #l1-scenarii-v2 .dlg-collapse{flex:0 0 auto;padding:0 7px;line-height:1.6;font-weight:700;cursor:pointer;color:var(--muted) !important;background:transparent !important;border:1px solid var(--border) !important;border-radius:var(--r-xs) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-collapse:hover{background:var(--surface) !important;color:var(--ink) !important}
    /* collapsed -> full-height strip docked to the LEFT (order), arrow ABOVE vertical title.
       per-id so it beats the per-id base flex/min-width above */
    #l1-scenarii-v2 #dlg-models.dlg-collapsed,#l1-scenarii-v2 #dlg-script.dlg-collapsed,#l1-scenarii-v2 #dlg-video.dlg-collapsed{flex:0 0 34px;min-width:34px;padding:0 !important;border-radius:var(--r-sm) !important;cursor:pointer;overflow:hidden}
    #l1-scenarii-v2 #dlg-models.dlg-collapsed{order:0}
    #l1-scenarii-v2 #dlg-script.dlg-collapsed{order:1}
    /* Video setup keeps its place (order 12) even when collapsed - stays between Dialogue and Work */
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
    #l1-scenarii-v2 .dlg-card{flex:1;min-width:0;background:var(--bg);border:1px solid var(--border-soft);border-radius:var(--r-sm);padding:8px 10px;display:flex;gap:10px;position:relative}
    #l1-scenarii-v2 .dlg-card-main{flex:1;min-width:0}
    #l1-scenarii-v2 .dlg-card-vid{flex:0 0 78px;display:flex;flex-direction:column;gap:5px;align-items:stretch}
    #l1-scenarii-v2 .dlg-ep-vid,#l1-scenarii-v2 .dlg-ep-ph{width:78px;aspect-ratio:9/16;border-radius:var(--r-xs);border:1px solid var(--border);background:var(--surface);object-fit:cover;cursor:zoom-in;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9px;color:var(--muted)}
    #l1-scenarii-v2 .dlg-ep-ph{cursor:default}
    #l1-scenarii-v2 .dlg-card-genvid{font-size:10px !important;padding:3px 6px !important;background:oklch(.52 .14 265) !important;color:var(--primary-ink) !important;border:none !important;border-radius:var(--r-xs) !important;box-shadow:none !important;cursor:pointer;white-space:nowrap}
    #l1-scenarii-v2 .dlg-card-genvid:disabled{opacity:.45;cursor:not-allowed}
    #l1-scenarii-v2 .dlg-card-busy{display:none}
    #l1-scenarii-v2 .dlg-card.busy>.dlg-card-main,#l1-scenarii-v2 .dlg-card.busy>.dlg-card-vid{filter:blur(4px);pointer-events:none;opacity:.75}
    #l1-scenarii-v2 .dlg-card.busy>.dlg-card-busy{display:flex;flex-direction:column;gap:3px;position:absolute;inset:0;align-items:center;justify-content:center;padding:10px;text-align:center;background:color-mix(in oklch,var(--bg) 55%,transparent);border-radius:var(--r-sm);z-index:2;animation:dlg-busy-pulse 1.6s ease-in-out infinite}
    @keyframes dlg-busy-pulse{0%,100%{opacity:.78}50%{opacity:1}}
    #l1-scenarii-v2 .dlg-card-busy-msg{font-size:11px;color:var(--ink);font-weight:600;text-shadow:0 1px 6px var(--bg)}
    #l1-scenarii-v2 .dlg-card-busy-eta{font-size:10px;color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums;text-shadow:0 1px 6px var(--bg)}
    #l1-scenarii-v2 .dlg-eng-sub{font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--muted);margin:12px 0 4px;padding-top:8px;border-top:1px solid var(--border-soft)}
    #dlg-lightbox video{max-width:100%;max-height:100%;border-radius:var(--r);box-shadow:var(--shadow)}
    #l1-scenarii-v2 .dlg-card.host{border-left:3px solid var(--primary)}
    #l1-scenarii-v2 .dlg-card.guest{border-left:3px solid var(--accent)}
    #l1-scenarii-v2 .dlg-card-h{display:flex;align-items:center;gap:6px;margin-bottom:5px}
    #l1-scenarii-v2 .dlg-card-who{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--muted)}
    #l1-scenarii-v2 .dlg-novoice{flex:0 0 auto;font-size:9px !important;text-transform:uppercase;letter-spacing:.03em;font-weight:700;padding:1px 7px !important;border-radius:var(--pill) !important;background:var(--danger) !important;color:#fff !important;border:none !important;box-shadow:none !important;cursor:pointer;line-height:1.6}
    #l1-scenarii-v2 .dlg-novoice:hover{filter:brightness(1.1)}
    #l1-scenarii-v2 .dlg-card-tx{font-size:12.5px;line-height:1.5;color:var(--ink)}
    #l1-scenarii-v2 .dlg-tag{color:var(--primary);font-weight:600;font-size:11px;cursor:pointer}
    #l1-scenarii-v2 .dlg-tag:hover{text-decoration:underline}
    #l1-scenarii-v2 .dlg-tagpop{position:fixed;z-index:9400;display:none;width:300px;max-height:244px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:8px}
    #l1-scenarii-v2 .dlg-tagpop.on{display:block}
    #l1-scenarii-v2 .dlg-tagpop-g{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:6px 2px 3px}
    #l1-scenarii-v2 .dlg-tagpop-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
    #l1-scenarii-v2 .dlg-tagpop-t{font-size:11px !important;padding:2px 8px !important;background:var(--bg) !important;border:1px solid var(--border-soft) !important;border-radius:var(--pill) !important;color:var(--ink) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-tagpop-t:hover{background:var(--primary-soft) !important;color:var(--primary) !important;border-color:var(--primary) !important}
    /* work header tools, card speaker slot, voice buttons, role picker */
    #l1-scenarii-v2 .dlg-head-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    #l1-scenarii-v2 .dlg-vall{font-size:11px !important;padding:3px 9px !important}
    #l1-scenarii-v2 .dlg-card-h{display:flex;align-items:center;gap:6px;margin-bottom:5px;justify-content:space-between}
    #l1-scenarii-v2 .dlg-card-spk{display:flex;align-items:center;gap:6px;min-width:0}
    #l1-scenarii-v2 .dlg-av{width:26px;height:26px;border-radius:50%;object-fit:cover;border:1px solid var(--border);cursor:pointer;flex:0 0 auto}
    #l1-scenarii-v2 .dlg-av:hover{border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-av-add{width:26px;height:26px;border-radius:50% !important;padding:0 !important;font-size:15px !important;line-height:1 !important;display:flex;align-items:center;justify-content:center;color:var(--muted) !important;background:var(--bg) !important;border:1px dashed var(--border) !important;cursor:pointer;flex:0 0 auto;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-av-add:hover{border-color:var(--primary) !important;color:var(--ink) !important}
    #l1-scenarii-v2 .dlg-card-acts{display:flex;align-items:center;gap:5px;flex:0 0 auto}
    #l1-scenarii-v2 .dlg-card-dur{flex:0 0 auto;font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums}
    #l1-scenarii-v2 .dlg-card-voice{flex:0 0 auto;font-size:12px !important;padding:2px 7px !important;background:var(--surface-2) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-card-play{flex:0 0 auto;font-size:12px !important;padding:2px 8px !important;background:var(--primary-soft) !important;border:1px solid var(--primary) !important;border-radius:var(--r-xs) !important;color:var(--primary) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-card-play.playing{background:var(--primary) !important;color:var(--primary-ink) !important}
    #l1-scenarii-v2 .dlg-card-voice.dirty{background:oklch(.80 .15 85) !important;border-color:oklch(.72 .15 85) !important;color:#1a1400 !important;animation:dlg-pulse 1.4s ease-in-out infinite}
    @keyframes dlg-pulse{0%,100%{box-shadow:0 0 0 0 oklch(.80 .15 85 / .55)}50%{box-shadow:0 0 0 5px oklch(.80 .15 85 / 0)}}
    #l1-scenarii-v2 .dlg-card-reset{flex:0 0 auto;font-size:12px !important;padding:2px 7px !important;background:var(--surface-2) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;color:var(--muted) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-card-reset:hover{color:var(--ink) !important;border-color:var(--muted) !important}
    #l1-scenarii-v2 .dlg-card-tx{outline:none}
    #l1-scenarii-v2 .dlg-card-tx:focus{box-shadow:inset 0 0 0 1px var(--primary);border-radius:4px}
    #l1-scenarii-v2 .dlg-pick{position:fixed;z-index:9100;width:228px;max-height:330px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:6px}
    #l1-scenarii-v2 .dlg-pick-h{font-size:11px;font-weight:700;color:var(--ink);padding:4px 6px 6px}
    #l1-scenarii-v2 .dlg-pick-g{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px 6px 2px}
    #l1-scenarii-v2 .dlg-pick-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--r-xs);cursor:pointer}
    #l1-scenarii-v2 .dlg-pick-row:hover{background:var(--surface-2)}
    #l1-scenarii-v2 .dlg-pick-row.cur{background:var(--primary-soft);outline:1px solid var(--primary)}
    #l1-scenarii-v2 .dlg-pick-badge{margin-left:auto;flex:0 0 auto;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--primary);font-weight:700}
    #l1-scenarii-v2 .dlg-pick-row img{width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid var(--border)}
    #l1-scenarii-v2 .dlg-pick-row span{font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    /* cast pills (one per row) replace Host/Guest inputs */
    #l1-scenarii-v2 .dlg-cast{display:flex;flex-direction:column;gap:6px;margin-top:10px}
    #l1-scenarii-v2 .dlg-castpill{display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border-soft);border-radius:var(--pill);padding:4px 12px 4px 4px}
    #l1-scenarii-v2 .dlg-castpill[data-role="host"]{border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-castpill[data-role="guest"]{border-color:var(--danger)}
    /* Video setup: cast row (host blue / guest red), thumbnails only */
    #l1-scenarii-v2 #dlg-vs-cast{display:flex;gap:10px;margin-bottom:12px}
    #l1-scenarii-v2 .dlg-vs-char{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border-soft);border-top-width:3px;border-radius:var(--r-sm);padding:8px}
    #l1-scenarii-v2 .dlg-vs-char.host{border-top-color:var(--primary)}
    #l1-scenarii-v2 .dlg-vs-char.guest{border-top-color:var(--danger)}
    #l1-scenarii-v2 .dlg-vs-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--muted)}
    #l1-scenarii-v2 .dlg-vs-av{width:100%;max-width:120px;aspect-ratio:1/1;object-fit:cover;object-position:top;border-radius:var(--r-xs);border:2px solid var(--border);background:var(--surface);cursor:pointer}
    #l1-scenarii-v2 .dlg-vs-char.host .dlg-vs-av{border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-vs-char.guest .dlg-vs-av{border-color:var(--danger)}
    #l1-scenarii-v2 .dlg-vs-av:hover{filter:brightness(1.06)}
    #l1-scenarii-v2 .dlg-vs-add{width:100%;max-width:120px;aspect-ratio:1/1;border-radius:var(--r-xs) !important;font-size:26px !important;display:flex;align-items:center;justify-content:center;color:var(--muted) !important;background:var(--surface) !important;border:1.5px dashed var(--border) !important;cursor:pointer;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-vs-char.host .dlg-vs-add{border-color:var(--primary) !important;color:var(--primary) !important}
    #l1-scenarii-v2 .dlg-vs-char.guest .dlg-vs-add{border-color:var(--danger) !important;color:var(--danger) !important}
    #l1-scenarii-v2 .dlg-vs-nm{font-size:11px;color:var(--ink);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #l1-scenarii-v2 .dlg-vs-newshoot{font-size:10px !important;padding:3px 8px !important;background:var(--surface-2) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;color:var(--muted) !important;box-shadow:none !important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #l1-scenarii-v2 .dlg-vs-char.both{border-top-color:var(--accent)}
    #l1-scenarii-v2 .dlg-vs-ph{width:100%;max-width:120px;aspect-ratio:1/1;border-radius:var(--r-xs);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;line-height:1.3;color:var(--muted);background:var(--surface)}
    /* Video setup: format/location rows + thumbnail dropdown */
    #l1-scenarii-v2 .dlg-vs-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    #l1-scenarii-v2 .dlg-vs-row>span{flex:0 0 64px;font-size:11px;color:var(--muted)}
    #l1-scenarii-v2 .dlg-vs-sel{flex:1;min-width:0;padding-top:4px !important;padding-bottom:4px !important;min-height:0 !important;height:auto !important}
    #l1-scenarii-v2 .dlg-vs-ddwrap{flex:1;min-width:0}
    #l1-scenarii-v2 .dlg-dd-trig{width:100% !important;display:flex;align-items:center;gap:8px;padding:3px 8px !important;background:var(--bg) !important;border:1px solid var(--border) !important;border-radius:var(--r-sm) !important;color:var(--ink) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-dd-trig img{width:26px;height:26px;object-fit:cover;border-radius:4px;border:1px solid var(--border);flex:0 0 auto}
    #l1-scenarii-v2 .dlg-dd-lbl{flex:1;min-width:0;text-align:left;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
    #l1-scenarii-v2 .dlg-dd-trig .dlg-dd-car{flex:0 0 auto;color:var(--muted);font-size:10px}
    #l1-scenarii-v2 .dlg-dd-pop{position:fixed;z-index:9400;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;align-content:start}
    #l1-scenarii-v2 .dlg-dd-it{padding:0 !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;background:var(--bg) !important;cursor:pointer;overflow:hidden;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-dd-it img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
    #l1-scenarii-v2 .dlg-dd-it.sel{border-color:var(--primary) !important;outline:1px solid var(--primary)}
    #l1-scenarii-v2 .dlg-dd-it:hover{border-color:var(--muted) !important}
    #l1-scenarii-v2 .dlg-dd-it span{display:block;font-size:9px;color:var(--muted);padding:2px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    /* Video setup: pose row (mirror toggle + generate) */
    #l1-scenarii-v2 .dlg-vs-poserow{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    #l1-scenarii-v2 .dlg-vs-poserow .dlg-vs-genbtn{flex:1}
    #l1-scenarii-v2 .dlg-ios{position:relative;display:inline-flex;flex:0 0 auto;cursor:pointer;align-items:center}
    #l1-scenarii-v2 .dlg-ios input{position:absolute;opacity:0;width:0;height:0;margin:0}
    #l1-scenarii-v2 .dlg-ios-track{width:36px;height:21px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);display:inline-block;position:relative;transition:background .15s,border-color .15s}
    #l1-scenarii-v2 .dlg-ios-knob{position:absolute;top:1px;left:1px;width:17px;height:17px;border-radius:50%;background:var(--ink);transition:transform .15s,background .15s;box-shadow:0 1px 2px rgba(0,0,0,.35)}
    #l1-scenarii-v2 .dlg-ios input:checked + .dlg-ios-track{background:var(--primary);border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-ios input:checked + .dlg-ios-track .dlg-ios-knob{transform:translateX(15px);background:var(--primary-ink)}
    #l1-scenarii-v2 .dlg-vs-genbtn{font-size:11px !important;padding:4px 12px !important;background:var(--primary) !important;color:var(--primary-ink) !important;border:none !important;border-radius:var(--r-sm) !important;box-shadow:none !important;cursor:pointer}
    #l1-scenarii-v2 .dlg-vs-genbtn.busy{background:var(--danger) !important}
    #l1-scenarii-v2 .dlg-vs-poseprog{font-size:10px;color:var(--muted);min-height:12px;margin-bottom:6px}
    #l1-scenarii-v2 .dlg-vs-poseprog.bright{color:var(--accent);font-weight:700;font-size:11px}
    #l1-scenarii-v2 .dlg-vs-char.both.busy{animation:dlg-busy-pulse 1.6s ease-in-out infinite}
    #l1-scenarii-v2 .dlg-vs-char.both.busy .dlg-vs-bothimg,#l1-scenarii-v2 .dlg-vs-char.both.busy .dlg-vs-ph{filter:blur(4px)}
    /* Video setup: gear (engine settings) button + engine popup */
    #l1-scenarii-v2 .dlg-head .dlg-gear{background:transparent !important;border:none !important;box-shadow:none !important;color:var(--muted) !important;font-size:15px !important;line-height:1;padding:2px 4px !important;cursor:pointer;margin-left:auto}
    #l1-scenarii-v2 .dlg-head .dlg-gear:hover{color:var(--ink) !important}
    #l1-scenarii-v2 #dlg-video.dlg-collapsed .dlg-gear{display:none}
    #l1-scenarii-v2 .dlg-eng-pop{position:fixed;z-index:9500;width:300px;max-height:380px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:12px}
    #l1-scenarii-v2 .dlg-eng-pop.wide{width:560px}
    #l1-scenarii-v2 .dlg-eng-cols{display:flex;gap:14px}
    #l1-scenarii-v2 .dlg-eng-col{flex:1;min-width:0}
    #l1-scenarii-v2 .dlg-eng-sysbtn{margin-top:10px;width:100%;font-size:11px !important;padding:5px 10px !important;background:var(--surface-2) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-sm) !important;color:var(--ink) !important;box-shadow:none !important;cursor:pointer}
    #l1-scenarii-v2 .dlg-eng-sysbtn:hover{border-color:var(--muted) !important}
    #l1-scenarii-v2 .dlg-sys-pop{position:fixed;z-index:9600;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,92vw);max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:12px}
    #l1-scenarii-v2 .dlg-sys-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    #l1-scenarii-v2 .dlg-sys-title{font-size:12px;font-weight:600;color:var(--ink);flex:1}
    #l1-scenarii-v2 .dlg-sys-head select{max-width:200px;padding:3px 6px !important;min-height:0 !important;height:auto !important;font-size:11px}
    #l1-scenarii-v2 .dlg-sys-head button{font-size:11px !important;padding:4px 10px !important;border-radius:var(--r-xs) !important;border:1px solid var(--border-soft) !important;background:var(--surface-2) !important;color:var(--ink) !important;box-shadow:none !important;cursor:pointer}
    #l1-scenarii-v2 .dlg-sys-head .dlg-sys-save{background:var(--primary) !important;color:var(--primary-ink) !important;border:none !important}
    #l1-scenarii-v2 .dlg-sys-x{cursor:pointer;color:var(--muted);font-size:18px;line-height:1;padding:0 4px}
    #l1-scenarii-v2 .dlg-sys-x:hover{color:var(--ink)}
    #l1-scenarii-v2 .dlg-sys-legend{font-size:10px;color:var(--muted);margin-bottom:8px;line-height:1.4}
    #l1-scenarii-v2 .dlg-sys-ed{flex:1;min-height:240px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px;font-size:12px;line-height:1.55;color:var(--ink);white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace}
    #l1-scenarii-v2 .dlg-sys-ed .dlg-sys-chip,#l1-scenarii-v2 .dlg-sys-chips .dlg-sys-chip{display:inline;background:var(--primary-soft);color:var(--primary);border:1px solid var(--primary);border-radius:4px;padding:0 3px;font-weight:600;font-size:11px;white-space:nowrap}
    #l1-scenarii-v2 .dlg-sys-status{font-size:10px;color:var(--muted);min-height:12px;margin-top:6px}
    #l1-scenarii-v2 .dlg-eng-head{display:flex;align-items:center;font-size:12px;font-weight:600;color:var(--ink);margin-bottom:10px}
    #l1-scenarii-v2 .dlg-eng-x{margin-left:auto;cursor:pointer;color:var(--muted);font-size:16px;line-height:1}
    #l1-scenarii-v2 .dlg-eng-x:hover{color:var(--ink)}
    #l1-scenarii-v2 .dlg-eng-form{margin-top:8px}
    #l1-scenarii-v2 .dlg-eng-form .engine-settings-row{display:flex;flex-direction:column;gap:6px}
    #l1-scenarii-v2 .dlg-eng-form .es-row{display:flex;align-items:center;gap:8px}
    #l1-scenarii-v2 .dlg-eng-form .es-row label{flex:0 0 110px;font-size:11px;color:var(--muted)}
    #l1-scenarii-v2 .dlg-eng-form .es-row select,#l1-scenarii-v2 .dlg-eng-form .es-row input{flex:1;min-width:0;padding:3px 6px !important;min-height:0 !important;height:auto !important;font-size:11px}
    #l1-scenarii-v2 .dlg-eng-form .es-desc{font-size:9px;color:var(--muted);opacity:.8;margin:-2px 0 4px}
    /* Video setup: Both slot generate button + pool nav */
    #l1-scenarii-v2 .dlg-vs-bothimg{object-position:center;cursor:zoom-in}
    #dlg-lightbox{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:24px}
    #dlg-lightbox img{max-width:100%;max-height:100%;border-radius:var(--r);box-shadow:var(--shadow);object-fit:contain}
    #l1-scenarii-v2 .dlg-vs-bothgen{font-size:10px !important;padding:3px 10px !important;background:oklch(.52 .14 265) !important;color:var(--primary-ink) !important;border:none !important;border-radius:var(--r-xs) !important;box-shadow:none !important;cursor:pointer}
    #l1-scenarii-v2 .dlg-vs-bothgen:disabled{opacity:.45;cursor:not-allowed}
    #l1-scenarii-v2 .dlg-vs-bothgen.busy{background:var(--danger) !important}
    #l1-scenarii-v2 .dlg-vs-poolnav{display:flex;align-items:center;justify-content:center;gap:6px;font-size:10px;color:var(--muted)}
    #l1-scenarii-v2 .dlg-vs-poolnav button{padding:0 6px !important;background:var(--surface-2) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;color:var(--ink) !important;box-shadow:none !important;cursor:pointer;line-height:1.4}
    #l1-scenarii-v2 .dlg-castpill-th{width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex:0 0 auto;background:var(--surface);cursor:pointer}
    #l1-scenarii-v2 .dlg-castpill-th:hover{border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-castpill-add{width:28px;height:28px;border-radius:50% !important;padding:0 !important;font-size:15px !important;line-height:1 !important;display:flex;align-items:center;justify-content:center;color:var(--muted) !important;background:var(--surface) !important;border:1px dashed var(--border) !important;cursor:pointer;flex:0 0 auto;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-castpill-add:hover{border-color:var(--primary) !important;color:var(--ink) !important}
    #l1-scenarii-v2 .dlg-castpill-add.hint{border-color:var(--primary) !important;color:var(--primary) !important}
    #l1-scenarii-v2 .dlg-castpill.reuse-hint{border-style:dashed;border-color:var(--primary)}
    #l1-scenarii-v2 .dlg-castpill-gender{flex:0 0 auto;font-size:12px;font-weight:700;line-height:1;padding:2px 6px;border-radius:var(--pill);background:var(--surface);border:1px solid var(--border-soft)}
    #l1-scenarii-v2 .dlg-castpill-gender.g-male{color:oklch(.72 .12 250)}
    #l1-scenarii-v2 .dlg-castpill-gender.g-female{color:oklch(.75 .15 350)}
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
    #l1-scenarii-v2 .dlg-modal-f{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
    /* "New scenario" popdown menu */
    #l1-scenarii-v2 .dlg-newmenu{position:fixed;z-index:9200;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);box-shadow:var(--shadow);padding:5px;min-width:230px;max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:4px}
    #l1-scenarii-v2 .dlg-newmenu-h{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:4px 6px}
    #l1-scenarii-v2 .dlg-newmenu button{text-align:left;font-size:12px !important;padding:7px 9px !important;background:var(--bg) !important;border:1px solid var(--border-soft) !important;border-radius:var(--r-xs) !important;color:var(--ink) !important;box-shadow:none !important}
    #l1-scenarii-v2 .dlg-newmenu button:hover{background:var(--surface-2) !important}`;
    document.head.appendChild(s);
  }
  async function buildModelsPanel(){
    const host=$('dlg-models'); if(!host) return;
    host.innerHTML='<h2>Models</h2><div class="notice" style="padding:6px 8px">Loading…</div>';
    let chars=[], obrazy=[];
    try{ const d=await fetch('/api/char-store/list').then(x=>x.json()); chars=(d&&d.chars)||[]; }catch(e){}
    try{ const d=await fetch('/api/userdata/obrazy').then(x=>x.json()); obrazy=(d&&d.list)||[]; }catch(e){}
    // photoshoots per character (obraz.charId === char.id): aggregate pool/variations
    const shotsBy={}, latestBy={};   // per character: covers per photoshoot + the NEWEST photoshoot's cover (obraz.id = timestamp)
    obrazy.forEach(o=>{ const cid=String(o.charId||''); if(!cid) return;
      const main=(window.pickMainObrazImage&&window.pickMainObrazImage(o)) || o.char || (((Array.isArray(o.pool)?o.pool:[]).find(p=>p&&p.final&&p.file)||{}).file) || (((Array.isArray(o.pool)?o.pool:[])[0]||{}).file) || ((Array.isArray(o.variations)?o.variations:[])[0]);
      if(!main) return;
      (shotsBy[cid]||(shotsBy[cid]=[])).push(main);
      const ts=Number(o.id)||0; if(!latestBy[cid] || ts>latestBy[cid].ts) latestBy[cid]={ts,img:main}; });
    chars.forEach(c=>{ const shots=shotsBy[String(c.id)]||[]; c._shots=Array.from(new Set(shots.length?shots:[c.portrait,c.baseFace].filter(Boolean))); c._latestShot=(latestBy[String(c.id)]||{}).img||''; c._portrait=c.portrait||c.baseFace||c._shots[0]||''; });
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
  let _fly=null,_flyHideT=null,_flyDocH=null;
  function _flyEl(){ if(_fly) return _fly; _fly=document.createElement('div'); _fly.className='dlg-flyout'; _fly.addEventListener('mouseenter',()=>clearTimeout(_flyHideT)); _fly.addEventListener('mouseleave',()=>scheduleHideFlyout()); (document.getElementById('l1-scenarii-v2')||document.body).appendChild(_fly); return _fly; }
  function _hideFlyout(){ clearTimeout(_flyHideT); if(_fly) _fly.classList.remove('on'); if(_flyDocH){ document.removeEventListener('mousedown',_flyDocH,true); _flyDocH=null; } _dlgSortActive(); }
  function scheduleHideFlyout(delay){ clearTimeout(_flyHideT); _flyHideT=setTimeout(_hideFlyout, delay||700); }
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
    // keep inside the viewport: flip to the left of the anchor if it would overflow the right edge
    const fw=fly.offsetWidth||320; if(rb.right+6+fw>(window.innerWidth||1200)) fly.style.left=Math.max(8,rb.left-fw-6)+'px';
    // click outside closes; auto-close 0.7s after opening unless the cursor moves onto the flyout
    if(_flyDocH) document.removeEventListener('mousedown',_flyDocH,true);
    _flyDocH=(e)=>{ if(_fly&&!_fly.contains(e.target)&&e.target!==anchor&&!(anchor.contains&&anchor.contains(e.target))) _hideFlyout(); };
    setTimeout(()=>{ if(_flyDocH) document.addEventListener('mousedown',_flyDocH,true); },0);
    scheduleHideFlyout();
  }
  // dlgActive is a fixed 2-slot [host, guest]. Left-column toggle fills host then guest,
  // dropping the host when a 3rd is added; the card "+" picker assigns a specific slot.
  function activateModel(id){ id=String(id); if(dlgActive.includes(id)) return;
    if(!dlgActive[0]) dlgActive[0]=id; else if(!dlgActive[1]) dlgActive[1]=id; else { dlgActive[0]=dlgActive[1]; dlgActive[1]=id; }
    if(!dlgFrame[id]){ const f=_dlgDefaultFrame(id); if(f) dlgFrame[id]=f; }   // no photoshoot chosen -> latest photoshoot
    renderActive(); if(_dlgInited) renderDlgScenario(); }
  function deactivateModel(id){ id=String(id); if(dlgActive[0]===id) dlgActive[0]=null; if(dlgActive[1]===id) dlgActive[1]=null; renderActive(); if(_dlgInited) renderDlgScenario(); }
  function setRoleModel(speaker,id,frame){ id=String(id); const slot=speaker==='guest'?1:0;
    if(dlgActive[1-slot]===id) dlgActive[1-slot]=null;   // same model can't hold both roles
    dlgActive[slot]=id; if(frame) dlgFrame[id]=frame; dlgReuseHint[speaker]=null;   // hint resolved
    renderActive(); renderDlgScenario(); _dlgAutosave(); }
  function renderActive(){
    const host=$('dlg-models'); if(!host) return;
    host.querySelectorAll('.dlg-row').forEach(row=>{
      const slot=dlgActive.indexOf(String(row.dataset.id)), on=slot>=0;
      row.classList.toggle('active',on);
      const t=row.querySelector('.dlg-row-tog'); if(t) t.checked=on;
      const b=row.querySelector('.dlg-badge'); if(b){ if(on){ b.style.display=''; b.textContent= slot===0?'H':'G'; } else b.style.display='none'; }
    });
    renderCastPills();
    renderVideoCast();
  }
  function _dlgRoleModel(speaker){ const id=speaker==='guest'?dlgActive[1]:dlgActive[0]; if(!id) return null; const m=_dlgModels.find(x=>String(x.id)===String(id)); if(!m) return null; return { id, name:m.name||'', frame: dlgFrame[id]||_dlgModelImg(m) }; }
  function _dlgRoleGender(speaker){ const id=speaker==='guest'?dlgActive[1]:dlgActive[0]; if(!id) return ''; const m=_dlgModels.find(x=>String(x.id)===String(id)); return m?String(m.gender||''):''; }
  function _dlgCollapseModels(){ const h=$('dlg-models'); if(!h||h.classList.contains('dlg-collapsed')) return; h.classList.add('dlg-collapsed'); const b=h.querySelector('.dlg-collapse'); if(b) b.textContent='▸'; }
  // Size the columns to the viewport (the app's flex chain doesn't cap height here).
  // Shrink first to clear any overflow scroll, then measure top and set the real height.
  function _dlgFitHeight(){ const cols=$('dlg-cols'), pd=$('pl-dialogues'); if(!cols||!pd||pd.style.display==='none') return;
    try{ const sc=document.scrollingElement||document.documentElement; if(sc) sc.scrollTop=0; }catch(e){}
    const tabs=ROOT().querySelector('.pl-tabs');   // stable anchor (its position doesn't depend on the columns' height)
    const anchorBottom = tabs ? tabs.getBoundingClientRect().bottom : cols.getBoundingClientRect().top;
    cols.style.height=Math.max(200, Math.round(window.innerHeight - anchorBottom - 30))+'px'; }
  // ════════════════════════════════════════════════════════════════════════
  // UGC-AD dialogues-style view (Phase 3). Interface-first: this slice builds the
  // 4-column scaffold (Character | Scenario | Video setup | Fragments) reusing the
  // dialogue .dlg-* styling. Panels are filled + wired in later slices.
  // ════════════════════════════════════════════════════════════════════════
  let _ugcInited=false;
  function _injectUgcCSS(){ if(document.getElementById('ugc-css')) return; const s=document.createElement('style'); s.id='ugc-css'; s.textContent=`
    #l1-scenarii-v2 #pl-ugc{overflow:hidden}
    #l1-scenarii-v2 #pl-ugc .wrap{max-width:none;width:auto;margin:0;box-sizing:border-box;padding:14px 20px 0}`; document.head.appendChild(s); }
  function _ugcFitHeight(){ const cols=$('ugc-cols'), pu=$('pl-ugc'); if(!cols||!pu||pu.style.display==='none') return;
    try{ const sc=document.scrollingElement||document.documentElement; if(sc) sc.scrollTop=0; }catch(e){}
    const tabs=ROOT().querySelector('.pl-tabs');
    const anchorBottom = tabs ? tabs.getBoundingClientRect().bottom : cols.getBoundingClientRect().top;
    cols.style.height=Math.max(200, Math.round(window.innerHeight - anchorBottom - 30))+'px'; }
  function initUgc(){ if(_ugcInited) return; _ugcInited=true; _injectDlgCSS(); _injectUgcCSS();
    _ugcBuildCharPanel(); _ugcBuildScriptPanel(); _ugcBuildVideoPanel(); _ugcBuildWorkPanel();
    if(!window._ugcFitWired){ window._ugcFitWired=true; window.addEventListener('resize',()=>{ if(state.type==='ugc_ad') _ugcFitHeight(); }); }
    setTimeout(_ugcFitHeight,30);
  }
  function _ugcBuildCharPanel(){ const h=$('ugc-char'); if(!h) return;
    h.innerHTML=_dlgHead('Character')+`<div class="dlg-body"><div class="notice">One presenter for the whole ad - picker coming next.</div></div>`;
    _wireCollapse(h); }
  function _ugcBuildScriptPanel(){ const h=$('ugc-script'); if(!h) return;
    h.innerHTML=_dlgHead('Scenario')+`<div class="dlg-body"><div class="notice">Topic / vertical / taboo / scenes + Generate script - coming next.</div></div>`;
    _wireCollapse(h); }
  function _ugcBuildVideoPanel(){ const h=$('ugc-video'); if(!h) return;
    h.innerHTML=`<div class="dlg-head"><span class="dlg-title">Video setup</span><button class="dlg-gear" type="button" title="Engine settings">&#9881;</button><button class="dlg-collapse" type="button" title="Collapse">&#9666;</button></div><div class="dlg-body"><div class="notice">Product / format / camera / location + engine - coming next.</div></div>`;
    _wireCollapse(h); _dlgSetCollapsed(h,true); }
  function _ugcBuildWorkPanel(){ const h=$('ugc-work'); if(!h) return;
    h.innerHTML=`<div class="dlg-head"><span class="dlg-title">Fragments</span></div><div class="dlg-body"><div class="notice">Per-line cards: voice - frame - video - coming next.</div></div>`; }

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
    $('format').addEventListener('change',e=>{ setFormat(e.target.value); _updateModeBtn(); });
    { const mb=$('modeBtn'); if(mb){ mb.addEventListener('click',e=>{ e.stopPropagation(); _toggleModeDropdown(mb); }); mb.addEventListener('mouseenter',()=>_openModeDropdown(mb)); mb.addEventListener('mouseleave',()=>{ _modeDDcloseT=setTimeout(_closeModeDropdown,350); }); } _updateModeBtn(); }
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
