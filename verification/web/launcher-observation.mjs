// Diagnose launcher dismissal with DOM identities and event names only: no
// terminal output, conversation text, CLI arguments or credential values.
const script = `(async()=>{
    const {connection}=await import('/src/connection.ts');
    const history=[];
    const push=value=>{history.push({at:Date.now(),...value});if(history.length>512)history.shift();};
    window.__launcherObservation=history;
    const nodes=new WeakMap();let nextNode=0;
    const id=e=>{if(!nodes.has(e))nodes.set(e,++nextNode);return nodes.get(e);};
    const menu=()=>document.querySelector('.new-items-popover[data-state="open"]');
    const target=e=>({tag:e?.tagName,field:e?.getAttribute('data-iori-field'),action:e?.getAttribute('data-iori-action'),panel:e?.closest('[data-iori-workspace-panel]')?.getAttribute('data-iori-workspace-panel')});
    let previous='';
    const snapshot=()=>{
      const m=menu();const state={open:Boolean(m),menuNode:m?id(m):null,items:m?[...m.querySelectorAll('[data-iori-cli-id]')].map(e=>({cli:e.getAttribute('data-iori-cli-id'),node:id(e)})):[]};
      const json=JSON.stringify(state);if(json!==previous){previous=json;push({kind:'dom',...state});}
    };
    new MutationObserver(snapshot).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-state']});
    document.addEventListener('focusin',e=>{if(menu())push({kind:'focusin',target:target(e.target)});},true);
    document.addEventListener('click',e=>{const element=e.target.closest('[data-iori-action],[data-iori-cli-id]');if(menu()||element?.getAttribute('data-iori-action')==='workspace-add-tab')push({kind:'click',target:target(element),cli:element?.getAttribute('data-iori-cli-id')});},true);
    const focus=HTMLElement.prototype.focus;
    HTMLElement.prototype.focus=function(...args){
      if(menu())push({kind:'focus-call',target:target(this),stack:new Error().stack.split('\\n').slice(1,10)});
      return focus.apply(this,args);
    };
    connection.subscribeHostEvents((_host,event)=>{if(event.type.startsWith('cli.'))push({kind:'host-event',type:event.type,cli:event.cliId,open:Boolean(menu())});});
    snapshot();return true;
  })()`;

export async function observeLauncher(page, appUrl) {
  await page.addInitScript({
    content: `if (window.location.origin === ${JSON.stringify(new URL(appUrl).origin)}) {
      window.addEventListener('DOMContentLoaded',()=>{void ${script};},{once:true});
    }`,
  });
}

export async function launcherObservation(page) {
  return page.evaluate("window.__launcherObservation??[]").catch(() => []);
}
