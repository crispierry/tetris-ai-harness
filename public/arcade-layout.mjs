// Relocate the same controls at narrow widths; no duplicate IDs or action state.
const rail=document.querySelector('.control-rail'),toolbar=rail?.querySelector('.play-toolbar'),stage=document.querySelector('.arcade-stage');
if(rail&&toolbar&&stage){
 const anchor=document.createComment('desktop play controls'),slot=document.createElement('div');slot.className='mobile-control-slot';
 toolbar.before(anchor);stage.before(slot);const query=matchMedia('(max-width: 960px)');
 const layout=()=>{if(query.matches)slot.append(toolbar);else anchor.after(toolbar);};
 layout();query.addEventListener('change',layout);addEventListener('pageshow',layout);
 addEventListener('pagehide',event=>{if(!event.persisted){query.removeEventListener('change',layout);removeEventListener('pageshow',layout);}});
}
