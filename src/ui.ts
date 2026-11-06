const paths = {
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  wave: '<path d="M2 12h3c2 0 2-7 4-7s2 14 5 14 2-7 4-7h4"/>',
  cube: '<path d="m12 2 8.5 4.9v10.2L12 22l-8.5-4.9V6.9zM3.5 6.9l8.5 5 8.5-5M12 12v10"/>',
  folder:
    '<path d="M3 17V5.8A1.8 1.8 0 0 1 4.8 4H9l2 2h8a1.8 1.8 0 0 1 1.8 1.8V10"/><path d="M4 19h14a1.6 1.6 0 0 0 1.5-1.1l2.1-6.2A1.3 1.3 0 0 0 20.4 10H7.2a1.5 1.5 0 0 0-1.4 1l-2.5 7A.8.8 0 0 0 4 19Z"/>',
  sliders:
    '<path d="M3 7h9m5 0h4M3 17h3m5 0h10"/><circle cx="14.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>',
  focus:
    '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="12" r="3"/>',
  rotate:
    '<path d="M19.5 11c-1.3-2-4.1-3.4-7.5-3.4-4.7 0-8.5 2.4-8.5 5.3s3.8 5.3 8.5 5.3c3.3 0 6.1-1.2 7.6-3M19.5 6.5V11H15"/>',
  grid: '<path d="M4 8h16M4 16h16M8 4v16m8-16v16"/>',
  pointer: '<path d="m6 3 12 9-6 .7-2.2 5.8z"/>',
  layers:
    '<path d="m12 3 9 4.8-9 4.8-9-4.8zM3 12l9 4.8 9-4.8M3 16l9 4.8 9-4.8"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  package:
    '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5"/>',
  eye: '<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/><rect x="9" y="9" width="6" height="6" rx=".5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
};
type IconName = keyof typeof paths;
export const icon = (name: IconName) =>
  '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
  paths[name] +
  "</svg>";
const glyph =
  '<svg class="package-glyph" viewBox="0 0 112 88" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M56 8 88 26 56 45 24 26Z" fill="#e8b975" fill-opacity=".12"/><path d="m24 26 32 19v36L24 62zm32 19 32-19v36L56 81Z" fill="#e8b975" fill-opacity=".035"/><path d="m40 17 32 18v10l-7 4V39L33 21" fill="#e8b975" fill-opacity=".18"/><path d="m30 57 9 5m-9-1 6 3"/><path d="M9 24v-5h5m84 0h5v5M9 64v5h5m84 0h5v-5" opacity=".45"/></g></svg>';

export function buildUI() {
  document.querySelector("#app")!.innerHTML = `
    <header class="topbar">
      <div class="identity"><img src="/mark.svg" alt="" width="32" height="32"><span>Toonbench</span></div>
      <span class="header-sep"></span><span class="product">Model viewer</span>
      <div class="session"><i></i> LOCAL SESSION</div>
      <button class="primary open" type="button">${icon("folder")} ファイルを開く</button>
      <input id="file" type="file" accept=".unitypackage" hidden>
    </header>
    <main>
      <section class="workspace" aria-label="モデルプレビュー">
        <div class="panel-title"><span class="title-icon">${icon("cube")}</span><h1>ビューポート</h1><span class="panel-end mono">SCENE / 01</span></div>
        <div class="stage" id="stage">
          <div class="projection"><b class="cross">+</b><span>Perspective</span></div>
          <div class="stage-meta"><i></i><span>WEBGL 2</span></div>
          <div class="cover" id="cover">
            <div class="welcome" id="welcome">${glyph}<div class="eyebrow">PACKAGE IMPORT</div><h2>モデルを開く</h2><p>.unitypackage をここにドロップ</p>
              <button class="select-file open" type="button">${icon("folder")} ファイルを選択</button>
            </div>
            <div class="loading-card" id="loading" hidden><span class="spinner"></span><h2 id="load-title">読み込み中</h2><p id="load-phase" aria-live="polite"></p></div>
          </div>
          <div class="view-tools"><button id="home" class="view-btn" disabled title="全体を表示 (R)" aria-label="全体を表示">${icon("focus")}</button><span></span><button id="spin" class="view-btn" disabled title="自動回転" aria-label="自動回転" aria-pressed="false">${icon("rotate")}</button></div>
          <div class="drag-shade">.unitypackage をドロップ</div>
        </div>
        <div class="underbar">${icon("pointer")}<span><b>回転</b> ドラッグ</span><i></i><span><b>移動</b> 右ドラッグ</span><i></i><span><b>ズーム</b> スクロール</span></div>
      </section>
      <aside class="inspector">
        <div class="panel-title"><span class="title-icon">${icon("sliders")}</span><h2>インスペクター</h2></div>
        <div class="inspector-body">
          <section class="side-section"><div class="section-caption"><span>01</span><h3>パッケージ</h3></div>
            <div class="file-card">${icon("package")}<div><strong id="file-name">未読み込み</strong><small id="file-info">UNITYPACKAGE</small></div></div>
            <label class="field-title" for="model">表示モデル</label><select id="model" disabled><option>モデル未選択</option></select>
          </section>
          <section class="side-section motion-panel"><div class="section-caption"><span>02</span><h3>モーション</h3><small id="motion-badge" class="motion-badge">STANDBY</small></div>
            <div class="motion-line"><button id="play-motion" class="play-btn" title="再生" aria-label="再生" disabled>${icon("play")}</button><select id="motion" aria-label="全身モーション" disabled><option>モデル未選択</option></select>
            <select id="speed" aria-label="再生速度" disabled><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div>
            <label class="compact-setting" for="expression"><span>表情</span><select id="expression" aria-label="表情" disabled><option>モデルのまま</option></select></label>
            <label class="setting" for="spring"><span>${icon("wave")} 揺れの強さ</span><output id="spring-value" for="spring">100%</output></label>
            <input type="range" id="spring" min="0" max="100" step="5" value="100" disabled>
            <div class="spring-info"><span id="spring-source">モデル未選択</span><button id="nudge" disabled>揺らす</button></div>
          </section>
          <section class="side-section"><div class="section-caption"><span>03</span><h3>モデル情報</h3></div>
            <div class="metrics"><div><span>メッシュ</span><b id="meshes">—</b></div><div><span>マテリアル</span><b id="materials">—</b></div>
            <div><span>三角形</span><b id="triangles">—</b></div><div><span>テクスチャ</span><b id="textures">—</b></div></div>
            <details id="material-panel" hidden><summary id="material-caption">マテリアル内訳</summary><div id="material-list"></div></details>
          </section>
          <section class="side-section"><div class="section-caption"><span>04</span><h3>表示設定</h3></div>
            <div class="setting"><span>背景色</span><div class="swatches">
              <button class="swatch selected" type="button" style="--swatch:#36383b" data-color="#36383b" title="グラファイト" aria-label="背景色：グラファイト" aria-pressed="true"></button>
              <button class="swatch" type="button" style="--swatch:#b9b3ac" data-color="#b9b3ac" title="ウォームグレー" aria-label="背景色：ウォームグレー" aria-pressed="false"></button>
              <button class="swatch" type="button" style="--swatch:#697988" data-color="#697988" title="スレート" aria-label="背景色：スレート" aria-pressed="false"></button>
            </div></div>
            <label class="setting" for="light"><span>${icon("sun")} ライト強度</span><output id="light-value" for="light">1.0×</output></label><input type="range" id="light" min="0.2" max="2" step="0.1" value="1">
            <div class="setting grid-setting"><span>${icon("grid")} 床グリッド</span><button class="switch" id="grid" role="switch" aria-label="床グリッド" aria-checked="true"></button></div>
          </section>
          <details id="warning-panel" hidden><summary id="warning-count"></summary><ul id="warnings"></ul></details>
        </div>
        <div class="engine">${icon("chip")}<div><small>RENDER ENGINE</small><b>three.js <span>/</span> lilToon</b></div></div>
      </aside>
    </main>
    <footer><span class="status" role="status"><i id="status-dot"></i><span id="status">ファイルを待機中</span></span><span class="foot-brand">TOONBENCH <b>/</b> VIEWER</span></footer>
    <div id="error" role="alert" hidden><span id="error-text"></span><button aria-label="メッセージを閉じる" id="close-error">×</button></div>
  `;
}
