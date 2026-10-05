import {Image} from 'expo-image';
import {useEffect,useState} from 'react';
import {StyleSheet,View} from 'react-native';
import {ImageIcon} from 'lucide-react-native';
import {useApp} from '@/context/app-context';
import {Colors,Radius} from '@/constants/theme';
export function StationPhoto({path,compact=false,label='Foto da estação'}:{path?:string;compact?:boolean;label?:string}){
 const {stationPhotoSource,user}=useApp();
 const [source,setSource]=useState<{uri:string;headers?:Record<string,string>}|null>(null);
 useEffect(()=>{let active=true;setSource(null);if(path)void stationPhotoSource(path).then(s=>{if(active)setSource(s)}).catch(()=>undefined);return()=>{active=false}},[path,stationPhotoSource,user?.id]);
 return <View style={compact?styles.thumbnail:styles.photo}>{source?<Image accessibilityLabel={label} source={source} contentFit="cover" cachePolicy="none" style={StyleSheet.absoluteFill} onError={()=>setSource(null)}/>:<ImageIcon color={Colors.textFaint} size={compact?22:40}/>}</View>;
}
const styles=StyleSheet.create({photo:{width:300,height:185,borderRadius:Radius.medium,backgroundColor:Colors.surfaceSoft,overflow:'hidden',alignItems:'center',justifyContent:'center'},thumbnail:{width:46,height:46,borderRadius:14,backgroundColor:Colors.surfaceSoft,overflow:'hidden',alignItems:'center',justifyContent:'center'}});
