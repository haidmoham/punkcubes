const place = () => {
 const target = document.querySelector(".footer-note");
 if(!target || target.querySelector('shin86-signature')) return;
 const host = document.createElement('div'); host.className = 'signature-placement'; host.style.cssText = "margin-left:auto;";
 host.innerHTML = '<shin86-signature ></shin86-signature>'; target.append(host);
};
place();
new MutationObserver(place).observe(document.body,{childList:true,subtree:true});
