'use client';
import {useEffect,useState} from 'react';
import {ImageIcon} from 'lucide-react';
import {api,empsApiUrl} from '@/services/emps-api';
import styles from './platform.module.css';
export function StationPhoto({id,alt,version}:{id?:string;alt:string;version?:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{let alive=true,objectUrl='';setUrl('');if(id)void api.ensureSession().then(s=>fetch(empsApiUrl+'/v2/station-photos/'+id,{headers:{Authorization:'Bearer '+s.token}})).then(r=>{if(!r.ok)throw Error('Foto indisponível');return r.blob()}).then(blob=>{objectUrl=URL.createObjectURL(blob);if(alive)setUrl(objectUrl)}).catch(()=>undefined);return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[id,version]);
 return <div className={styles.photo}>{url?<img src={url} alt={alt}/>:<ImageIcon size={32} aria-label="Sem foto"/>}</div>;
}
