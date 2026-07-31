// For every suite that reads a file this batch CHANGED, extract its source-text assertions
// and EVALUATE them against the new contents. No database needed - these are string checks,
// which is exactly the class that has been reaching the owner broken.
//
// Scans across NEWLINES: a check() spanning two lines is the common shape, and a line-based
// extractor silently skips it - which is how three of these reached him.
const fs=require("fs"), path=require("path");
const CHANGED=process.argv.slice(2);
if(!CHANGED.length){ console.log("usage: node assertcheck.js <changed files...>"); process.exit(2); }
const suites=fs.readdirSync("src/db").filter(f=>/^selfTest_.*\.ts$/.test(f));
let checked=0, skipped=0; const broken=[];

/** Every check(...) argument list in a file, brace-balanced across newlines. */
function checkCalls(src){
  const out=[]; let i=0;
  while((i=src.indexOf("check(",i))!==-1){
    if(/[\w.]/.test(src[i-1]||"")){ i+=6; continue; }
    let d=1,j=i+6,inS=null,inRe=false;
    while(j<src.length&&d>0){
      const c=src[j],p=src[j-1];
      if(inS){ if(c===inS&&p!=="\\")inS=null; }
      else if(inRe){ if(c==="/"&&p!=="\\")inRe=false; else if(c==="\n")inRe=false; }
      else if(c==='"'||c==="'"||c==="`")inS=c;
      else if(c==="/"&&/[(,=&|!]\s*$/.test(src.slice(Math.max(0,j-3),j)))inRe=true;
      else if(c==="(")d++; else if(c===")")d--;
      j++;
    }
    out.push({ text: src.slice(i+6, j-1), line: src.slice(0,i).split("\n").length });
    i=j;
  }
  return out;
}

for(const f of suites){
  const src=fs.readFileSync(path.join("src/db",f),"utf8");
  const vars={};
  for(const ch of CHANGED){
    const base=ch.replace(/^.*\//,"");
    const re=new RegExp("(?:const|let)\\s+(\\w+)\\s*(?::[^=]+)?=\\s*(?:readFileSync|read)\\([^)]*"+base.replace(/\./g,"\\.")+"[^)]*\\)","g");
    let m; while((m=re.exec(src))) vars[m[1]]=ch;
  }
  if(!Object.keys(vars).length) continue;

  for(const call of checkCalls(src)){
    const used=Object.keys(vars).filter(v=>new RegExp("\\b"+v+"\\b").test(call.text));
    if(!used.length) continue;
    // the condition is everything before the final top-level comma (the label)
    let d=0,inS=null,cut=-1;
    for(let k=0;k<call.text.length;k++){
      const c=call.text[k],p=call.text[k-1];
      if(inS){ if(c===inS&&p!=="\\")inS=null; continue; }
      if(c==='"'||c==="'"||c==="`"){inS=c;continue;}
      if(c==="("||c==="["||c==="{")d++;
      else if(c===")"||c==="]"||c==="}")d--;
      else if(c===","&&d===0)cut=k;
    }
    const cond=(cut>0?call.text.slice(0,cut):call.text).trim();
    if(!/\.test\(|\.includes\(|\.indexOf\(/.test(cond)){ skipped++; continue; }
    if(/await|prisma|db\.|fetch\(|document|process\./.test(cond)){ skipped++; continue; }
    const scope={};
    for(const v of used) scope[v]=fs.readFileSync(vars[v],"utf8");
    try{
      const val=new Function(...Object.keys(scope), "return ("+cond+");")(...Object.values(scope));
      checked++;
      if(val!==true) broken.push([f,call.line,cond.replace(/\s+/g," ").slice(0,86)]);
    }catch(e){ skipped++; }
  }
}
// A RATCHET, not an absolute check. Some assertions were already broken before any of this
// tooling existed, and failing on those makes the signal useless - the same reasoning
// designRatchet uses for the layout counters. A recorded baseline means this fails only when
// something NEW breaks, and tells you when a baseline entry has been FIXED so it can shrink.
const BASELINE = path.join(__dirname, "assertcheck.baseline.json");
const key = (b) => `${b[0]}::${b[2]}`;
const nowBroken = new Set(broken.map(key));
console.log(`  evaluated ${checked} source-text assertions (${skipped} not statically evaluable)`);

if (process.argv.includes("--record")) {
  fs.writeFileSync(BASELINE, JSON.stringify({ note: "Assertions already broken when this ratchet was introduced. It fails only on ADDITIONS. Shrink it when you fix one.", broken: [...nowBroken].sort() }, null, 2) + "\n");
  console.log(`  recorded ${nowBroken.size} known-broken assertions as the baseline`);
  process.exit(0);
}
let known = new Set();
try { known = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).broken || []); }
catch { console.log("  (no baseline recorded - run with --record once)"); }

const added = [...nowBroken].filter((k) => !known.has(k));
const fixed = [...known].filter((k) => !nowBroken.has(k));
if (fixed.length) {
  console.log(`  ${fixed.length} baseline assertion(s) now PASS - remove them from the baseline:`);
  for (const k of fixed) console.log("    " + k.split("::")[0].replace("selfTest_", "") + "  " + k.split("::")[1].slice(0, 70));
}
if (!added.length) { console.log(`  NO NEW BREAKAGE (${known.size} known-broken, unchanged)`); process.exit(0); }
console.log("  NEWLY BROKEN BY THIS CHANGE:");
for (const b of broken) if (added.includes(key(b))) console.log("    " + b[0].replace("selfTest_", "") + ":" + b[1] + "  " + b[2]);
process.exit(1);
