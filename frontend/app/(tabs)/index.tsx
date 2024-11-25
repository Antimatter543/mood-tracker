import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { globalStyles, colors } from '../../styles/global';
import { Layout } from '../../components/PageContainer';

export default function Home() {
  return (
    <Layout contentStyle={{
        justifyContent: "flex-start", // Custom justification
    }}>
          <View style={globalStyles.card}>
            <Text style={globalStyles.title}>Mood Trackersss</Text>
            {/* Your mood tracking content will go here */}
          </View>
          
          <View style={globalStyles.card}>
            <Text style={globalStyles.title}>Mood Tracker</Text>
            {/* Your mood tracking content will go here */}
            <Text>Hello</Text>

          </View>
    </Layout>
  );
}
