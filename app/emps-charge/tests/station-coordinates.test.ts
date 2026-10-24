import assert from 'node:assert/strict';
import test from 'node:test';
import type { Coordinate, Station } from '../src/domain/models';
import { validCoordinate, stationHasCoordinates, stationMapPoints } from '../src/utils/coordinates';
import { compareDistanceFrom, distanceInKm, formatDistance } from '../src/utils/formatters';

const origin:Coordinate={latitude:-23.56,longitude:-46.65};
export const unlocated:Station={id:'13',name:'Prédio Comercial',address:'Demonstração',neighborhood:'',city:'',
 coordinates:null,coordinatesUnavailable:true,openingHours:'24h',amenities:[],chargerIds:['51']};
const located:Station={...unlocated,id:'39',name:'Shopping',coordinates:origin,coordinatesUnavailable:false};

test('QR station without coordinates stays usable without a fabricated distance or map marker',()=>{
 const stations=[unlocated,located];
 assert.equal(stationHasCoordinates(unlocated),false);
 assert.equal(distanceInKm(origin,unlocated.coordinates),null);
 assert.equal(formatDistance(distanceInKm(origin,unlocated.coordinates)),'Distância indisponível');
 assert.deepEqual(stationMapPoints(stations,[],unlocated.id).map(p=>p.id),['39']);
 const sorted=[...stations].sort((a,b)=>compareDistanceFrom(origin,a.coordinates,b.coordinates));
 assert.deepEqual(sorted.map(s=>s.id),['39','13']);
 assert.equal(sorted[1].coordinates,null);
 assert.equal(sorted[1].chargerIds[0],'51');
 assert.equal(compareDistanceFrom(origin,null,null),0);
});

test('missing, partial, nonfinite and out-of-range coordinates are unavailable; real zero is valid',()=>{
 for(const value of [null,undefined,{}, {latitude:0}, {latitude:null,longitude:0},
  {latitude:NaN,longitude:0},{latitude:0,longitude:Infinity},{latitude:91,longitude:0},
  {latitude:0,longitude:-181},{latitude:'0',longitude:0}]){
  assert.equal(validCoordinate(value),false);
  assert.equal(distanceInKm(origin,value as Coordinate),null);
 }
 assert.equal(validCoordinate({latitude:0,longitude:0}),true);
 assert.equal(distanceInKm(origin,origin),0);
 assert.equal(formatDistance(0),'0 m');
 assert.equal(formatDistance(NaN),'Distância indisponível');
 assert.equal(stationMapPoints([{...located,coordinatesUnavailable:true}],[]).length,0);
});
