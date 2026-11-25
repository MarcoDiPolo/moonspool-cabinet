(() => {
  "use strict";
  const el = id => document.getElementById(id);

  function engraveMoon() {
    const canvas = el("moon");
    const pen = canvas.getContext("2d");
    if (!pen) return;
    pen.scale(2, 2);
    let seed = 452;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    function line(x, y, x2, y2) {
      pen.beginPath(); pen.moveTo(x, y); pen.lineTo(x2, y2); pen.stroke();
    }
    function star(x, y, radius) {
      pen.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 - Math.PI / 2;
        const r = i % 2 ? radius * .23 : radius;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) pen.moveTo(px, py);
        else pen.lineTo(px, py);
      }
      pen.closePath(); pen.fill();
    }
    const cx = 151, cy = 69, radius = 37;
    pen.strokeStyle = "#ba9d67"; pen.lineWidth = .65;
    for (const [rx, ry, rot, start, end] of [[106,33,-.35,.03,2.9],[106,33,-.35,3.45,6.05],[94,48,-.39,.03,1],[94,48,-.39,2.2,3.65],[53,53,0,-1.38,.44],[53,53,0,1.78,4.26]]) {
      pen.beginPath(); pen.ellipse(cx,cy,rx,ry,rot,start,end); pen.stroke();
    }
    pen.strokeStyle = "#b1976275"; pen.lineWidth = .65;
    [[18,80,35,57],[35,57,53,67],[53,67,75,33],[208,41,233,26],[233,26,258,43],[258,43,273,17]].forEach(a => line(...a));
    pen.fillStyle = "#cfb57c";
    for (let i = 0; i < 90; i++) {
      const x = 11 + random() * 260, y = 5 + random() * 132;
      if (Math.hypot(x-cx,y-cy) > 46) pen.fillRect(x,y,.55+random()*.7,.55+random()*.65);
    }
    pen.fillStyle = "#dfc48c";
    [[35,57,4],[53,67,2.8],[75,33,4],[233,26,5],[258,43,3],[273,17,3],[76,108,6],[196,119,4],[22,95,2]].forEach(a => star(...a));
    pen.save();
    pen.beginPath(); pen.arc(cx,cy,radius,0,Math.PI*2); pen.clip();
    pen.fillStyle = "#dec795"; pen.fillRect(cx-radius,cy-radius,2*radius,2*radius);
    pen.strokeStyle = "#716445"; pen.lineWidth = .65;
    for (let j = -46; j < 56; j += 3) {
      pen.beginPath(); pen.ellipse(cx+9,cy-3,Math.abs(j)+14,Math.abs(j)+23,-.36,1.4,4.46); pen.stroke();
    }
    for (let i = 0; i < 170; i++) {
      const x=cx-radius+random()*2*radius, y=cy-radius+random()*2*radius;
      pen.fillStyle = "#8e794d"; pen.fillRect(x,y,random()*1.2+.4,.6);
    }
    pen.beginPath(); pen.arc(cx+20,cy-11,33,0,Math.PI*2);
    pen.fillStyle = "#26372d"; pen.fill(); pen.strokeStyle="#9b895e"; pen.stroke();
    pen.restore();
    pen.strokeStyle="#d5bd85"; pen.lineWidth=.9;
    pen.beginPath(); pen.arc(cx,cy,radius,0,Math.PI*2); pen.stroke();
    for (let i=0; i<58; i++) {
      const a=i*Math.PI/29, length=i%5===0 ? 6 : 2;
      line(cx+41*Math.cos(a),cy+41*Math.sin(a),cx+(41+length)*Math.cos(a),cy+(41+length)*Math.sin(a));
    }
    pen.fillStyle="#d4b77c"; star(163,61,3.2);
  }

  engraveMoon();
  const engine = window.MoonRoll;
  const notice = el("notice");
  const say = message => { notice.textContent = message; };
  if (!engine) {
    say("The roll engine could not be loaded. Keep roll.js beside this page and reload.");
    return;
  }

  const labels = ["A3", "C4", "D4", "E4", "G4"];
  const length = 16;
  const grid = el("roll-grid");
  const library = el("library");
  const tempo = el("tempo");
  const history = [];
  const controls = {};
  for (const id of ["play","stop","undo","clear","export","share"]) controls[id] = el(id);
  const columns = [];
  const buttons = Array.from({length: 5}, () => []);
  let bpm = 96, preset = "Moonrise", pattern = [...engine.presets[preset]];
  let focusPitch = 4, focusStep = 0, activeStep = -1;
  let audio, bus, playing = false, run = 0, timer, nextStep, nextTime;
  let beatEdit = null;
  const tails = new Set(), visualTimers = new Set();

  function create(tag, css, role, text) {
    const node = document.createElement(tag);
    node.className = css;
    if (role) node.setAttribute("role", role);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function row(index) {
    const node = create("div","grid-row","row");
    node.setAttribute("aria-rowindex", index);
    grid.append(node);
    return node;
  }
  function headerCell(parent, text, column, role) {
    const css = role === "columnheader" ? "step-label" : "row-label";
    const header = create("span",css,role,text);
    header.setAttribute("aria-colindex", column);
    parent.append(header);
    return header;
  }
  const topRow = row(1);
  headerCell(topRow,"",1,"columnheader").setAttribute("aria-label","Pitch");
  for (let step=0; step<length; step++) {
    const header = headerCell(topRow,step+1,step+2,"columnheader");
    if (step % 4 === 0) header.classList.add("downbeat");
    columns.push([header]);
  }
  for (let pitch=4; pitch>=0; pitch--) {
    const strip = row(6-pitch);
    headerCell(strip,labels[pitch],1,"rowheader");
    for (let step=0; step<length; step++) {
      const cell = create("div","cell","gridcell");
      cell.setAttribute("aria-colindex",step+2);
      if (step % 4===0) cell.classList.add("downbeat");
      const button = create("button","hole");
      button.type = "button";
      button.setAttribute("aria-label", labels[pitch]+", step "+(step+1));
      button.tabIndex = pitch === focusPitch && step === focusStep ? 0 : -1;
      button.addEventListener("focus", () => moveFocus(pitch,step,false));
      button.addEventListener("click", () => {
        moveFocus(pitch,step,false);
        remember();
        pattern = engine.toggle(pattern,step,pitch);
        preset = "";
        render();
        say("");
      });
      button.addEventListener("keydown", event => {
        let x = step, y = pitch;
        switch (event.key) {
          case "ArrowLeft": x--; break;
          case "ArrowRight": x++; break;
          case "ArrowUp": y++; break;
          case "ArrowDown": y--; break;
          case "Home": x=0; if (event.ctrlKey) y=4; break;
          case "End": x=15; if (event.ctrlKey) y=0; break;
          default: return;
        }
        event.preventDefault();
        moveFocus(Math.max(0,Math.min(4,y)),Math.max(0,Math.min(15,x)),true);
      });
      cell.append(button); strip.append(cell);
      buttons[pitch][step] = button; columns[step].push(cell);
    }
  }
  function moveFocus(pitch, step, focus) {
    buttons[focusPitch][focusStep].tabIndex = -1;
    focusPitch=pitch; focusStep=step;
    buttons[pitch][step].tabIndex=0;
    if (focus) buttons[pitch][step].focus();
  }
  function snapshot() { return {pattern:[...pattern],bpm,preset}; }
  function remember(state = snapshot()) {
    history.push(state);
    if (history.length > 100) history.shift();
  }
  function render() {
    for (let pitch=0; pitch<5; pitch++)
      buttons[pitch].forEach((button,step) => button.setAttribute("aria-pressed", String(Boolean(pattern[step] & (1 << pitch)))));
    tempo.value = bpm;
    el("bpm").value = bpm;
    library.value = preset;
    controls.undo.disabled = history.length===0;
    controls.clear.disabled = !pattern.some(Boolean);
    controls.play.disabled = playing;
    controls.stop.disabled = !playing;
    el("lamp").classList.toggle("lit",playing);
    el("meter").textContent = playing ? "Playing" : "At rest";
  }
  function mark(step) {
    if (activeStep>=0) for (const cell of columns[activeStep]) cell.classList.remove("current");
    activeStep = step;
    if (step>=0) for (const cell of columns[step]) cell.classList.add("current");
    el("step").textContent = "Step "+(step<0 ? "··" : String(step+1).padStart(2,"0"))+" / 16";
  }
  function stop() {
    run++; playing=false;
    clearInterval(timer);
    visualTimers.forEach(clearTimeout); visualTimers.clear();
    const previousBus = bus;
    if (previousBus && audio) {
      const now=audio.currentTime;
      previousBus.gain.cancelScheduledValues(now);
      previousBus.gain.setValueAtTime(previousBus.gain.value,now);
      previousBus.gain.linearRampToValueAtTime(0,now+.015);
      for (const oscillator of tails) {
        try { oscillator.stop(now+.02); } catch { /* The voice has already ended. */ }
      }
      window.setTimeout(() => previousBus.disconnect(),50);
      bus=null;
    }
    mark(-1); render();
  }
  function pluck(note, time) {
    const freq = 440*Math.pow(2,(note-69)/12);
    for (const [multiple,volume,decay] of [[1,.13,.55],[2.01,.045,.27],[3.99,.018,.13]]) {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type="sine"; oscillator.frequency.value=freq*multiple;
      gain.gain.setValueAtTime(.0001,time);
      gain.gain.exponentialRampToValueAtTime(volume,time+.008);
      gain.gain.exponentialRampToValueAtTime(.0001,time+decay);
      oscillator.connect(gain); gain.connect(bus); tails.add(oscillator);
      oscillator.onended=() => { tails.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(time); oscillator.stop(time+decay+.025);
    }
  }
  function schedule(version) {
    if (version!==run || !playing) return;
    const now=audio.currentTime;
    if (nextTime<now-.08) nextTime=now+.01;
    while (nextTime<now+.095) {
      const step=nextStep, time=nextTime, mask=pattern[step];
      engine.notes.forEach((note,pitch) => { if (mask & (1<<pitch)) pluck(note,time); });
      const handle=window.setTimeout(() => {
        visualTimers.delete(handle);
        if (version===run) mark(step);
      },Math.max(0,(time-now)*1000));
      visualTimers.add(handle);
      nextStep=(step+1)%length;
      nextTime+=60/bpm/4;
    }
  }
  controls.play.addEventListener("click", async () => {
    if (playing) return;
    const version=++run;
    try {
      const Audio=window.AudioContext || window.webkitAudioContext;
      if (!Audio) { say("This browser cannot play audio. You can still export the roll as MIDI."); return; }
      audio ||= new Audio();
      playing=true; render();
      await audio.resume();
      if (version!==run) return;
      if (audio.state!=="running") throw new Error("Audio unavailable");
      bus=audio.createGain(); bus.gain.value=.63; bus.connect(audio.destination);
      say(""); nextStep=0; nextTime=audio.currentTime+.025;
      schedule(version); timer=window.setInterval(() => schedule(version),25);
    } catch {
      if (version===run) { stop(); say("Audio could not start. Check the sound permission for this page and press Play again."); }
    }
  });
  controls.stop.addEventListener("click",stop);
  window.addEventListener("pagehide",stop);

  for (const name of Object.keys(engine.presets)) library.add(new Option(name,name));
  library.addEventListener("change", () => {
    if (!Object.hasOwn(engine.presets,library.value)) { library.value=preset; return; }
    remember(); preset=library.value; pattern=[...engine.presets[preset]];
    render(); say(preset+" loaded.");
  });
  tempo.addEventListener("input",() => {
    beatEdit ||= snapshot(); bpm=Number(tempo.value); el("bpm").value=bpm;
  });
  tempo.addEventListener("change",() => {
    if (beatEdit && beatEdit.bpm!==bpm) remember(beatEdit);
    beatEdit=null; render();
  });
  controls.undo.addEventListener("click",() => {
    if (!history.length) return;
    ({pattern,bpm,preset}=history.pop()); render(); say("Undid the last change.");
  });
  controls.clear.addEventListener("click",() => {
    remember(); pattern=Array(length).fill(0); preset=""; render(); say("Roll cleared. Undo restores it.");
  });
  controls.export.addEventListener("click",() => {
    const data=engine.midi(pattern,bpm), file=new Blob([data],{type:"audio/midi"});
    const url=URL.createObjectURL(file), link=document.createElement("a");
    link.href=url; link.download="moonspool-"+(preset.toLowerCase() || "custom")+"-"+bpm+"bpm.mid";
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url),30000);
    say("Prepared "+link.download+" for download.");
  });
  function loadHash(rememberPrevious) {
    if (!location.hash) return;
    let loaded;
    try { loaded=engine.decode(location.hash.slice(1)); } catch { loaded=null; }
    if (!loaded) { say("This roll link is unreadable. The current roll is still open."); return; }
    if (rememberPrevious) remember();
    pattern=[...loaded.pattern]; bpm=loaded.bpm; preset="";
    render(); say("Opened the linked roll.");
  }
  window.addEventListener("hashchange",() => loadHash(true));
  controls.share.addEventListener("click",async () => {
    const token=engine.encode(pattern,bpm);
    const relative=location.protocol==="file:";
    const path=relative ? "./index.html" : location.origin+location.pathname;
    const url=path+"#"+token;
    const hint=relative ? " This relative link opens from a folder containing the cabinet." : "";
    el("copy-fallback").hidden=true;
    try {
      await navigator.clipboard.writeText(url);
      say("Roll link copied."+hint);
    } catch {
      el("copy-fallback").hidden=false;
      const field=el("link-text"); field.value=url; field.focus(); field.select();
      say("Copy the selected roll link."+hint);
    }
  });
  library.disabled=false; tempo.disabled=false; controls.export.disabled=false; controls.share.disabled=false;
  render(); loadHash(false);
})();
