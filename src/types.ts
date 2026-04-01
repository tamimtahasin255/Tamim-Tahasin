export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  email: string;
  role: "admin" | "user";
  createdAt: any;
}

export interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  createdAt: any;
}

export interface Call {
  id: string;
  callerId: string;
  receiverId: string;
  offer?: any;
  answer?: any;
  status: "calling" | "ongoing" | "ended";
  type: "video" | "voice" | "screen";
  createdAt: any;
}

export interface Candidate {
  id: string;
  candidate: any;
}
