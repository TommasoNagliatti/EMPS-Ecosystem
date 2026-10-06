import {Image} from 'expo-image';
import {useEffect,useState} from 'react';
import {StyleSheet,View} from 'react-native';
import {ImageIcon} from 'lucide-react-native';
import {useApp} from '@/context/app-context';
import {Colors,Radius} from '@/constants/theme';
export function StationPhoto({path,compact=false,label='Foto da estação'}:{path?:string;compact?:boolean;label?:string}){
 const {stationPhotoSource,user}=useApp();
 const [resolved,setResolved]=useState<{path:string;userId?:string;source:{uri:string;headers?:Record<string,string>}}|null>(null);
 useEffect(()=>{let active=true;if(path){const requestedPath=path;const requestedUserId=user?.id;void stationPhotoSource(requestedPath).then(source=>{if(active)setResolved({path:requestedPath,userId:requestedUserId,source})}).catch(()=>undefined)}return()=>{active=false}},[path,stationPhotoSource,user?.id]);
 const source=resolved&&resolved.path===path&&resolved.userId===user?.id?resolved.source:null;
 return <View style={compact?styles.thumbnail:styles.photo}>{source?<Image accessibilityLabel={label} source={source} contentFit="cover" cachePolicy="none" style={StyleSheet.absoluteFill} onError={()=>setResolved(current=>current&&current.path===path&&current.userId===user?.id?null:current)}/>:<ImageIcon color={Colors.textFaint} size={compact?22:40}/>}</View>;
}
const styles=StyleSheet.create({photo:{width:300,height:185,borderRadius:Radius.medium,backgroundColor:Colors.surfaceSoft,overflow:'hidden',alignItems:'center',justifyContent:'center'},thumbnail:{width:46,height:46,borderRadius:14,backgroundColor:Colors.surfaceSoft,overflow:'hidden',alignItems:'center',justifyContent:'center'}});
