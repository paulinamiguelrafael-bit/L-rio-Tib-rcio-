import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Search, Plus, MessageSquare, User, Navigation, Clock, Users, Send, ChevronLeft, X, Star, CheckCircle, AlertTriangle, Car, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Fix for Leaflet default icons
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// --- Types ---
interface Ride {
  id: string;
  creatorId: string;
  creatorName: string;
  origin: string;
  destination: string;
  time: string;
  seats: number;
  passengers: string[];
  status: 'open' | 'full' | 'completed';
  rideType: 'private' | 'taxi' | 'yango' | 'uber';
  price: number;
  earnings?: {
    driver: number;
    founder: number;
  };
}

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

// --- Map View Component ---
function MapView({ origin, destination }: { origin: string, destination: string }) {
  const [originCoords, setOriginCoords] = useState<[number, number] | null>(null);
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  useEffect(() => {
    const geocode = async (address: string, setter: (c: [number, number]) => void) => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
        const data = await res.json();
        if (data && data.length > 0) {
          setter([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        }
      } catch (e) {
        console.error("Geocoding error:", e);
      }
    };

    geocode(origin, setOriginCoords);
    geocode(destination, setDestCoords);
  }, [origin, destination]);

  function ChangeView({ coords }: { coords: [number, number][] }) {
    const map = useMap();
    if (coords.length > 0) {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
    return null;
  }

  const allCoords = [originCoords, destCoords].filter((c): c is [number, number] => c !== null);

  return (
    <div className="h-64 w-full rounded-2xl overflow-hidden border border-black/5 mb-4 z-0">
      <MapContainer center={[-23.5505, -46.6333]} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {originCoords && (
          <Marker position={originCoords}>
            <Popup>Origem: {origin}</Popup>
          </Marker>
        )}
        {destCoords && (
          <Marker position={destCoords}>
            <Popup>Destino: {destination}</Popup>
          </Marker>
        )}
        <ChangeView coords={allCoords} />
      </MapContainer>
    </div>
  );
}

// --- Main App Component ---
export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [rides, setRides] = useState<Ride[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [sosAlert, setSosAlert] = useState<{ senderName: string, rideId: string } | null>(null);
  const [selectedRideType, setSelectedRideType] = useState<'private' | 'taxi' | 'yango' | 'uber'>('private');
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Geolocation
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await res.json();
          if (data && data.display_name) {
            // Simplify address for the input
            const shortAddress = data.address.road || data.address.suburb || data.display_name.split(',')[0];
            setCurrentAddress(shortAddress);
          }
        } catch (e) {
          console.error("Reverse geocoding error:", e);
        }
      });
    }
  }, []);

  // WebSocket Connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'init':
          setUserId(data.userId);
          setUserName(data.name);
          break;
        case 'ride_created':
          setRides(prev => [...prev, data.ride]);
          break;
        case 'ride_updated':
          setRides(prev => prev.map(r => r.id === data.ride.id ? data.ride : r));
          if (activeRide?.id === data.ride.id) setActiveRide(data.ride);
          break;
        case 'new_message':
          if (activeRide?.id === data.rideId) {
            setMessages(prev => [...prev, data.message]);
          }
          break;
        case 'sos_alert':
          setSosAlert({ senderName: data.senderName, rideId: data.rideId });
          setTimeout(() => setSosAlert(null), 10000); // Hide alert after 10s
          break;
      }
    };

    setSocket(ws);
    return () => ws.close();
  }, [activeRide?.id]);

  // Initial Data Fetch
  useEffect(() => {
    fetch('/api/rides')
      .then(res => res.json())
      .then(setRides);
  }, []);

  // Fetch Messages when ride selected
  useEffect(() => {
    if (activeRide) {
      fetch(`/api/chats/${activeRide.id}`)
        .then(res => res.json())
        .then(setMessages);
    }
  }, [activeRide]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateRide = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const rideData = {
      type: 'create_ride',
      origin: formData.get('origin'),
      destination: formData.get('destination'),
      time: formData.get('time'),
      seats: Number(formData.get('seats')),
      price: Number(formData.get('price')),
      rideType: selectedRideType
    };
    socket?.send(JSON.stringify(rideData));
    setShowCreateModal(false);
  };

  const handleJoinRide = (rideId: string) => {
    socket?.send(JSON.stringify({ type: 'join_ride', rideId }));
  };

  const handleCompleteRide = (rideId: string) => {
    socket?.send(JSON.stringify({ type: 'complete_ride', rideId }));
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeRide) return;
    socket?.send(JSON.stringify({
      type: 'chat_message',
      rideId: activeRide.id,
      text: newMessage
    }));
    setNewMessage('');
  };

  const handleEmergency = () => {
    if (!activeRide) return;
    socket?.send(JSON.stringify({
      type: 'emergency_alert',
      rideId: activeRide.id,
      location: currentAddress
    }));
    alert("ALERTA DE EMERGÊNCIA ENVIADO! Os outros passageiros e o sistema foram notificados.");
  };

  const getRideTypeIcon = (type: string) => {
    switch (type) {
      case 'taxi': return <div className="bg-yellow-400 text-black px-2 py-0.5 rounded text-[8px] font-bold">TAXI</div>;
      case 'uber': return <div className="bg-black text-white px-2 py-0.5 rounded text-[8px] font-bold">UBER</div>;
      case 'yango': return <div className="bg-red-600 text-white px-2 py-0.5 rounded text-[8px] font-bold">YANGO</div>;
      default: return <div className="bg-blue-500 text-white px-2 py-0.5 rounded text-[8px] font-bold">PRIVADO</div>;
    }
  };

  const handleSubmitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRide || !reviewTarget) return;
    socket?.send(JSON.stringify({
      type: 'submit_review',
      rideId: activeRide.id,
      revieweeId: reviewTarget,
      rating,
      comment
    }));
    setShowReviewModal(false);
    setReviewTarget(null);
    setComment('');
  };

  const filteredRides = rides.filter(r => 
    r.origin.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.destination.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans">
      {/* SOS Alert Banner */}
      <AnimatePresence>
        {sosAlert && (
          <motion.div 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white p-4 flex items-center justify-between shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
              <div>
                <p className="font-bold text-sm">EMERGÊNCIA!</p>
                <p className="text-xs opacity-90">{sosAlert.senderName} ativou o botão de pânico.</p>
              </div>
            </div>
            <button onClick={() => setSosAlert(null)} className="p-2">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-10 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Navigation className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Conect</h1>
              <p className="text-[8px] opacity-30 font-bold uppercase tracking-widest">Fundado por Lério Tibúrcio</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium bg-black/5 px-2 py-1 rounded-full">{userName}</span>
            <User className="w-5 h-5 opacity-50" />
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 pb-24">
        {/* Search Bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
          <input 
            type="text" 
            placeholder="Para onde vamos?" 
            className="w-full bg-white border border-black/5 rounded-2xl py-3 pl-10 pr-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Driver Onboarding Banner */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-500 text-white p-5 rounded-3xl mb-8 shadow-lg shadow-emerald-500/20 relative overflow-hidden"
        >
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-white/20 p-1.5 rounded-lg">
                <Car className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Oportunidade Conect</span>
            </div>
            <h2 className="text-lg font-bold leading-tight mb-3">Qualquer motorista pode se cadastrar no Conect e fazer dinheiro.</h2>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="bg-white text-emerald-600 text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 hover:bg-emerald-50 transition-colors"
            >
              Começar a Ganhar
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="absolute -right-4 -bottom-4 opacity-10">
            <Car className="w-32 h-32" />
          </div>
        </motion.div>

        {/* Ride List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider opacity-40">Viagens Disponíveis</h2>
            <span className="text-xs opacity-40">{filteredRides.length} encontradas</span>
          </div>
          
          <AnimatePresence mode='popLayout'>
            {filteredRides.map((ride) => (
              <motion.div 
                key={ride.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`bg-white rounded-2xl p-4 shadow-sm border border-black/5 cursor-pointer hover:border-black/20 transition-colors ${ride.status === 'completed' ? 'opacity-60' : ''}`}
                onClick={() => setActiveRide(ride)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-sm font-medium">{ride.origin}</span>
                    </div>
                    <div className="w-px h-4 bg-black/10 ml-1" />
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-red-500" />
                      <span className="text-sm font-medium">{ride.destination}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex justify-end mb-1">
                      {getRideTypeIcon(ride.rideType)}
                    </div>
                    <div className="text-xs opacity-40 flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {ride.time}
                    </div>
                    <div className="text-xs font-bold text-emerald-600 mt-1">
                      {ride.price > 0 ? `Kz ${ride.price.toLocaleString()}` : 'Grátis'}
                    </div>
                    <div className="text-[10px] opacity-40 mt-0.5">
                      {ride.status === 'completed' ? 'Concluída' : `${ride.seats - ride.passengers.length} lugares livres`}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-3 border-t border-black/5">
                  <div className="flex -space-x-2">
                    {ride.passengers.map((p, i) => (
                      <div key={i} className="w-6 h-6 rounded-full bg-black/5 border-2 border-white flex items-center justify-center text-[10px] font-bold">
                        {p.slice(0, 1).toUpperCase()}
                      </div>
                    ))}
                  </div>
                  {!ride.passengers.includes(userId || '') && ride.passengers.length < ride.seats && ride.status === 'open' && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleJoinRide(ride.id); }}
                      className="bg-black text-white text-xs font-bold px-4 py-2 rounded-full hover:opacity-80 transition-opacity"
                    >
                      Reservar
                    </button>
                  )}
                  {ride.passengers.includes(userId || '') && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                      {ride.status === 'completed' ? 'Histórico' : 'Sua Viagem'}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredRides.length === 0 && (
            <div className="text-center py-12 opacity-30">
              <Navigation className="w-12 h-12 mx-auto mb-2" />
              <p className="text-sm">Nenhuma viagem encontrada</p>
            </div>
          )}
        </div>
      </main>

      {/* Footer with Founder Name */}
      <footer className="max-w-md mx-auto p-4 text-center opacity-20 pb-24">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Conect • Fundado por Lério Tibúrcio</p>
      </footer>

      {/* Floating Action Button */}
      <button 
        onClick={() => setShowCreateModal(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-black text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform z-20"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Create Ride Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowCreateModal(false)}
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 relative z-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Criar Nova Viagem</h2>
                <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-black/5 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleCreateRide} className="space-y-4">
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {(['private', 'taxi', 'yango', 'uber'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSelectedRideType(type)}
                      className={`flex-shrink-0 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${
                        selectedRideType === type ? 'bg-black text-white border-black' : 'bg-white text-black/40 border-black/5'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Origem</label>
                  <input 
                    name="origin" 
                    required 
                    defaultValue={currentAddress}
                    className="w-full bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10" 
                    placeholder="De onde você sai?" 
                  />
                  {currentAddress && <p className="text-[8px] opacity-30 mt-1">Usando sua localização atual</p>}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Destino</label>
                  <input name="destination" required className="w-full bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10" placeholder="Para onde você vai?" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Horário</label>
                    <input name="time" type="time" required className="w-full bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Assentos</label>
                    <input name="seats" type="number" min="1" max="8" defaultValue="4" required className="w-full bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Preço (Kz)</label>
                  <input name="price" type="number" min="0" step="100" defaultValue="1000" required className="w-full bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10" placeholder="Quanto custa a viagem?" />
                  <p className="text-[8px] opacity-30 mt-1">O motorista recebe 20% do valor total da viagem.</p>
                </div>
                <button type="submit" className="w-full bg-black text-white font-bold py-4 rounded-xl mt-4 hover:opacity-90 transition-opacity">
                  Publicar Viagem
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Chat / Ride Detail Overlay */}
      <AnimatePresence>
        {activeRide && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="fixed inset-0 bg-white z-40 flex flex-col"
          >
            <div className="p-4 border-b border-black/5 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveRide(null)} className="p-2 hover:bg-black/5 rounded-full">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-sm leading-tight">{activeRide.origin} → {activeRide.destination}</h2>
                    {getRideTypeIcon(activeRide.rideType)}
                  </div>
                  <p className="text-[10px] opacity-40 uppercase tracking-widest font-bold">{activeRide.time} • {activeRide.passengers.length} passageiros</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeRide.passengers.includes(userId || '') && activeRide.status !== 'completed' && (
                  <button 
                    onClick={handleEmergency}
                    className="w-10 h-10 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg animate-pulse"
                  >
                    <AlertTriangle className="w-5 h-5" />
                  </button>
                )}
                {activeRide.creatorId === userId && activeRide.status !== 'completed' && (
                  <button 
                    onClick={() => handleCompleteRide(activeRide.id)}
                    className="bg-emerald-500 text-white p-2 rounded-full"
                  >
                    <CheckCircle className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Map View */}
              <MapView origin={activeRide.origin} destination={activeRide.destination} />
              
              {/* Revenue Split Card for Creator */}
              {activeRide.creatorId === userId && activeRide.price > 0 && (
                <div className="bg-black text-white p-4 rounded-2xl space-y-3 shadow-xl">
                  <div className="flex justify-between items-center border-b border-white/10 pb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Faturamento do Motorista</span>
                    <span className="font-bold text-sm">Kz {activeRide.price.toLocaleString()}</span>
                  </div>
                  <div className="bg-white/5 p-3 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-widest opacity-40 mb-1">Seu Ganho Líquido (20%)</p>
                      <p className="text-emerald-400 font-bold text-lg">Kz {(activeRide.price * 0.2).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] font-bold uppercase tracking-widest opacity-40 mb-1">Taxa de Serviço</p>
                      <p className="text-white/40 text-[10px]">E-mola: 869206959</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Emergency Info Card */}
              {activeRide.passengers.includes(userId || '') && (
                <div className="bg-red-50 border border-red-100 p-3 rounded-2xl flex items-center gap-3">
                  <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-red-900 uppercase tracking-widest">Segurança Conect</p>
                    <p className="text-[9px] text-red-700">O botão SOS notifica todos os passageiros e a central de segurança.</p>
                  </div>
                </div>
              )}

              {activeRide.status === 'completed' && (
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-center mb-4">
                  <Star className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <h3 className="font-bold text-sm text-emerald-900">Viagem Concluída!</h3>
                  <p className="text-xs text-emerald-700 mt-1">Avalie seus companheiros de viagem para fortalecer a comunidade.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {activeRide.passengers.filter(p => p !== userId).map(pId => (
                      <button 
                        key={pId}
                        onClick={() => { setReviewTarget(pId); setShowReviewModal(true); }}
                        className="bg-white border border-emerald-200 text-[10px] font-bold px-3 py-2 rounded-full hover:bg-emerald-500 hover:text-white transition-colors"
                      >
                        Avaliar {pId.slice(0, 4)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.senderId === userId ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] font-bold opacity-30 mb-1 px-2">{msg.senderName}</span>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                    msg.senderId === userId 
                      ? 'bg-black text-white rounded-tr-none' 
                      : 'bg-black/5 text-black rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                  <span className="text-[8px] opacity-20 mt-1 px-2">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {activeRide.status !== 'completed' && (
              activeRide.passengers.includes(userId || '') ? (
                <form onSubmit={handleSendMessage} className="p-4 border-t border-black/5 flex gap-2 bg-white">
                  <input 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Combine os detalhes..." 
                    className="flex-1 bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10 text-sm"
                  />
                  <button type="submit" className="w-12 h-12 bg-black text-white rounded-xl flex items-center justify-center hover:opacity-90 transition-opacity">
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              ) : (
                <div className="p-6 bg-black/5 text-center">
                  <p className="text-xs opacity-40 mb-4">Você precisa reservar um lugar para entrar no chat.</p>
                  <button 
                    onClick={() => handleJoinRide(activeRide.id)}
                    className="bg-black text-white text-sm font-bold px-8 py-3 rounded-xl"
                  >
                    Reservar Agora
                  </button>
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Review Modal */}
      <AnimatePresence>
        {showReviewModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setShowReviewModal(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-3xl p-6 relative z-10 shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-2">Avaliar Viajante</h2>
              <p className="text-xs opacity-40 mb-6 uppercase tracking-widest font-bold">Usuário: {reviewTarget?.slice(0, 4)}</p>
              
              <div className="flex justify-center gap-2 mb-8">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} onClick={() => setRating(s)}>
                    <Star className={`w-8 h-8 ${s <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-black/10'}`} />
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmitReview} className="space-y-4">
                <textarea 
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Conte como foi a experiência..."
                  className="w-full bg-black/5 border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-black/10 text-sm h-24 resize-none"
                />
                <button type="submit" className="w-full bg-black text-white font-bold py-4 rounded-xl hover:opacity-90 transition-opacity">
                  Enviar Avaliação
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
