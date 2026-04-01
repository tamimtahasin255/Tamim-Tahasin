/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";
import { useEffect, useState, useRef } from "react";
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, collection, doc, setDoc, getDoc, getDocs, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, updateDoc, deleteDoc, type User, type DocumentData } from "./firebase";
import { type UserProfile, type Message, type Call } from "./types";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, Video, Phone, Monitor, LogOut, Send, User as UserIcon, X, Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, PhoneOff, AlertCircle } from "lucide-react";

const ADMIN_EMAIL = "tamimtahasin255@gmail.com";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    // @ts-ignore
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        // @ts-ignore
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = `Firestore Error: ${parsed.error} (${parsed.operationType} on ${parsed.path})`;
      } catch {
        // @ts-ignore
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-red-50 flex flex-col items-center justify-center p-4 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
          <h1 className="text-2xl font-bold text-red-900 mb-2">Something went wrong</h1>
          <p className="text-red-700 mb-6 max-w-md">{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-6 py-2 rounded-full hover:bg-red-700 transition-colors"
          >
            Reload Application
          </button>
        </div>
      );
    }

    // @ts-ignore
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

function MainApp() {
  const servers = {
    iceServers: [
      {
        urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
      },
    ],
    iceCandidatePoolSize: 10,
  };

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [callType, setCallType] = useState<"video" | "voice" | "screen">("video");
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          if (!userDoc.exists()) {
            const newProfile: UserProfile = {
              uid: u.uid,
              displayName: u.displayName || "Anonymous",
              photoURL: u.photoURL || "",
              email: u.email || "",
              role: u.email === ADMIN_EMAIL ? "admin" : "user",
              createdAt: serverTimestamp(),
            };
            await setDoc(doc(db, "users", u.uid), newProfile);
            setProfile(newProfile);
          } else {
            setProfile(userDoc.data() as UserProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const usersUnsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
      const usersData = snapshot.docs.map((doc) => doc.data() as UserProfile);
      setUsers(usersData.filter((u) => u.uid !== user.uid));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "users"));

    const messagesUnsubscribe = onSnapshot(
      query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(50)),
      (snapshot) => {
        const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Message));
        setMessages(msgs.reverse());
      }, (error) => handleFirestoreError(error, OperationType.LIST, "messages")
    );

    const callsUnsubscribe = onSnapshot(
      query(collection(db, "calls"), orderBy("createdAt", "desc"), limit(1)),
      (snapshot) => {
        const call = snapshot.docs[0]?.data() as Call;
        if (call && call.receiverId === user.uid && call.status === "calling") {
          setIncomingCall({ id: snapshot.docs[0].id, ...call });
        }
      }, (error) => handleFirestoreError(error, OperationType.LIST, "calls")
    );

    return () => {
      usersUnsubscribe();
      messagesUnsubscribe();
      callsUnsubscribe();
    };
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Set video streams to refs
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const sendMessage = async (text: string) => {
    if (!user || !text.trim()) return;
    try {
      await addDoc(collection(db, "messages"), {
        text,
        senderId: user.uid,
        senderName: user.displayName,
        senderPhoto: user.photoURL,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "messages");
    }
  };

  const startCall = async (receiverId: string, type: "video" | "voice" | "screen") => {
    if (!user) return;
    setIsCalling(true);
    setCallType(type);

    const peerConnection = new RTCPeerConnection(servers);
    setPc(peerConnection);

    let stream: MediaStream;
    try {
      if (type === "screen") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        setIsScreenSharing(true);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: type === "video", audio: true });
      }
      setLocalStream(stream);
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
    } catch (err) {
      console.error("Failed to get media stream", err);
      setIsCalling(false);
      return;
    }

    const remoteStream = new MediaStream();
    setRemoteStream(remoteStream);
    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
    };

    const callDoc = doc(collection(db, "calls"));
    const callerCandidates = collection(callDoc, "callerCandidates");
    const receiverCandidates = collection(callDoc, "receiverCandidates");

    peerConnection.onicecandidate = (event) => {
      event.candidate && addDoc(callerCandidates, event.candidate.toJSON());
    };

    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const callData: Call = {
      id: callDoc.id,
      callerId: user.uid,
      receiverId,
      offer: { type: offerDescription.type, sdp: offerDescription.sdp },
      status: "calling",
      type,
      createdAt: serverTimestamp(),
    };
    await setDoc(callDoc, callData);
    setActiveCall(callData);

    onSnapshot(callDoc, (snapshot) => {
      const data = snapshot.data() as Call;
      if (data?.answer && !peerConnection.currentRemoteDescription) {
        const answerDescription = new RTCSessionDescription(data.answer);
        peerConnection.setRemoteDescription(answerDescription);
      }
      if (data?.status === "ended") {
        endCall();
      }
    });

    onSnapshot(receiverCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnection.addIceCandidate(candidate);
        }
      });
    });
  };

  const answerCall = async () => {
    if (!incomingCall || !user) return;
    const callId = incomingCall.id;
    setIncomingCall(null);
    setCallType(incomingCall.type);

    const peerConnection = new RTCPeerConnection(servers);
    setPc(peerConnection);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: incomingCall.type === "video", audio: true });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
    } catch (err) {
      console.error("Failed to get media stream", err);
      return;
    }

    const remoteStream = new MediaStream();
    setRemoteStream(remoteStream);
    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
    };

    const callDoc = doc(db, "calls", callId);
    const callerCandidates = collection(callDoc, "callerCandidates");
    const receiverCandidates = collection(callDoc, "receiverCandidates");

    peerConnection.onicecandidate = (event) => {
      event.candidate && addDoc(receiverCandidates, event.candidate.toJSON());
    };

    const offerDescription = incomingCall.offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    await updateDoc(callDoc, {
      answer: { type: answerDescription.type, sdp: answerDescription.sdp },
      status: "ongoing",
    });
    setActiveCall({ ...incomingCall, status: "ongoing" });

    onSnapshot(callerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnection.addIceCandidate(candidate);
        }
      });
    });

    onSnapshot(callDoc, (snapshot) => {
      const data = snapshot.data() as Call;
      if (data?.status === "ended") {
        endCall();
      }
    });
  };

  const endCall = async () => {
    if (activeCall) {
      await updateDoc(doc(db, "calls", activeCall.id), { status: "ended" });
    }
    pc?.close();
    localStream?.getTracks().forEach((track) => track.stop());
    setPc(null);
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setIsCalling(false);
    setIsScreenSharing(false);
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => (track.enabled = !track.enabled));
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream && callType !== "voice") {
      localStream.getVideoTracks().forEach((track) => (track.enabled = !track.enabled));
      setIsVideoOff(!isVideoOff);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-[24px] shadow-sm max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mx-auto mb-6">
            <MessageSquare className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-light tracking-tight text-gray-900 mb-2">T Chat</h1>
          <p className="text-gray-500 mb-8">Secure, real-time communication for everyone.</p>
          <button
            onClick={handleLogin}
            className="w-full bg-black text-white rounded-full py-4 font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5 invert" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#F5F5F5] flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-100 flex flex-col">
        <div className="p-6 border-bottom border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-medium tracking-tight">T Chat</h2>
          <button onClick={handleLogout} className="text-gray-400 hover:text-black transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-4 px-2">Users Online</div>
          {users.map((u) => (
            <div
              key={u.uid}
              className="group flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img src={u.photoURL} alt={u.displayName} className="w-10 h-10 rounded-full bg-gray-100" referrerPolicy="no-referrer" />
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{u.displayName}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-tight">{u.role}</div>
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startCall(u.uid, "video")} className="p-2 hover:bg-white rounded-lg text-gray-600">
                  <Video className="w-4 h-4" />
                </button>
                <button onClick={() => startCall(u.uid, "voice")} className="p-2 hover:bg-white rounded-lg text-gray-600">
                  <Phone className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <img src={profile?.photoURL} alt={profile?.displayName} className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{profile?.displayName}</div>
              <div className="text-[10px] text-gray-400 truncate">{profile?.email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex gap-4", msg.senderId === user.uid ? "flex-row-reverse" : "")}>
              <img src={msg.senderPhoto} alt={msg.senderName} className="w-8 h-8 rounded-full mt-1" referrerPolicy="no-referrer" />
              <div className={cn("max-w-[70%] space-y-1", msg.senderId === user.uid ? "items-end" : "items-start")}>
                <div className="text-[10px] text-gray-400 px-1">{msg.senderName}</div>
                <div
                  className={cn(
                    "p-4 rounded-2xl text-sm leading-relaxed",
                    msg.senderId === user.uid ? "bg-black text-white rounded-tr-none" : "bg-gray-100 text-gray-900 rounded-tl-none"
                  )}
                >
                  {msg.text}
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="p-6 border-t border-gray-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("message") as HTMLInputElement;
              if (input.value.trim()) {
                sendMessage(input.value);
                input.value = "";
              }
            }}
            className="flex gap-3"
          >
            <input
              name="message"
              autoComplete="off"
              placeholder="Type a message..."
              className="flex-1 bg-gray-100 border-none rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-black transition-shadow"
            />
            <button type="submit" className="bg-black text-white p-3 rounded-full hover:bg-gray-800 transition-colors">
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>

      {/* Call Overlays */}
      <AnimatePresence>
        {incomingCall && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <div className="bg-white p-8 rounded-[32px] shadow-2xl max-w-sm w-full text-center">
              <div className="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-6 flex items-center justify-center overflow-hidden">
                <UserIcon className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-medium mb-2">Incoming {incomingCall.type} call</h3>
              <p className="text-gray-500 mb-8">Someone is calling you on T Chat</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setIncomingCall(null)}
                  className="flex-1 bg-gray-100 text-gray-900 py-4 rounded-full font-medium hover:bg-gray-200 transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={answerCall}
                  className="flex-1 bg-black text-white py-4 rounded-full font-medium hover:bg-gray-800 transition-colors"
                >
                  Accept
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {(activeCall || isCalling) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex flex-col"
          >
            {/* Video Grid */}
            <div className="flex-1 relative overflow-hidden">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-8 right-8 w-48 h-72 bg-gray-900 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Call Info */}
              <div className="absolute top-8 left-8 flex items-center gap-4">
                <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-white text-xs font-medium uppercase tracking-wider">
                    {activeCall?.status === "ongoing" ? "Live" : "Calling..."}
                  </span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="p-8 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center gap-6">
              <button
                onClick={toggleMute}
                className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center transition-all",
                  isMuted ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                )}
              >
                {isMuted ? <MicOff /> : <Mic />}
              </button>
              <button
                onClick={toggleVideo}
                className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center transition-all",
                  isVideoOff ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                )}
              >
                {isVideoOff ? <VideoOff /> : <VideoIcon />}
              </button>
              <button
                onClick={endCall}
                className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                <PhoneOff className="w-8 h-8" />
              </button>
              <button
                onClick={() => startCall(activeCall?.receiverId || "", "screen")}
                className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center transition-all",
                  isScreenSharing ? "bg-blue-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                )}
              >
                {isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
