import { Tabs } from "expo-router";
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export default function RootLayout() {
    return (
        <Tabs screenOptions={
            {
                tabBarActiveTintColor: "#ffd33d",
                // tabBarInactiveTintColor: "black",

                headerStyle: {
                    backgroundColor: '#25292e',
                  },
                  headerShadowVisible: false,
                  headerTintColor: '#fff',
                  tabBarStyle: {
                  backgroundColor: '#25292e',
                  },
            }}>

            <Tabs.Screen name="index" options={{
                title: 'Home',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'home-sharp' : 'home-outline'} color={color} size={30} /> // tabbar adds the custom icon thing to it instead of some default
                ),
            }}
            />
            <Tabs.Screen name="entry" options={{
                title: 'Entry form thingy',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'information-circle' : 'information-circle-outline'} color={color} size={24} />)
            }} />


            <Tabs.Screen name="timeline" options={{
                title: 'Timeline',
                tabBarIcon: ({ color, focused }) => (
                    <MaterialCommunityIcons name={focused ? 'timeline-text' : 'timeline-text-outline'} color={color} size={30} /> // tabbar adds the custom icon thing to it instead of some default
                ),
            }} />

            <Tabs.Screen name="social" options={{
                title: 'Social',
                tabBarIcon: ({ color, focused }) => (
                    <MaterialIcons name={focused ? 'mood' : 'mood'} color={color} size={30} /> // tabbar adds the custom icon thing to it instead of some default
                ),
            }} />
        </Tabs>);
}