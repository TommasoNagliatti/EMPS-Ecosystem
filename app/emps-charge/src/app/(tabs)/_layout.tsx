import { Tabs, useRouter } from 'expo-router';
import { History, Home, ScanLine, UserRound } from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';

export default function TabsLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.background },
        tabBarActiveTintColor: Colors.coral,
        tabBarInactiveTintColor: Colors.textFaint,
        tabBarLabelStyle: { fontFamily: Fonts.medium, fontSize: 9, marginTop: 2 },
        tabBarStyle: {
          backgroundColor: '#111318F8',
          borderTopColor: Colors.borderSoft,
          borderTopWidth: 1,
          height: 76,
          paddingBottom: 10,
          paddingTop: 8,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="scanner"
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push('/scan');
          },
        }}
        options={{
          title: 'Escanear',
          tabBarIcon: ({ color, size }) => <ScanLine color={color} size={size + 2} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Recargas',
          tabBarIcon: ({ color, size }) => <History color={color} size={size} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} strokeWidth={2.2} />,
        }}
      />
    </Tabs>
  );
}
