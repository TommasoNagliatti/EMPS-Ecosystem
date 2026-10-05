'use client';
export function authReturnPath(){
 if(typeof window==='undefined')return '/stations';
 const next=new URLSearchParams(window.location.search).get('next')??'';
 return /^\/(?:charge\/[a-zA-Z0-9_-]+|invites(?:\?[^#]*)?)$/.test(next)?next:'/stations';
}
