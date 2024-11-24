import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function MoodTracker() {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgb(49, 63, 80)','#1a1d21', '#25292e', 'rgb(49, 63, 80)']}
        style={styles.gradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.7, y: 1 }}
      >
        <View style={styles.contentContainer}>
          <View style={styles.card}>
            <Text style={styles.title}>Mood Tracker</Text>
            {/* Your mood tracking content will go here */}
          </View>
          
          <View style={styles.card}>
            <Text style={styles.title}>Mood Tracker</Text>
            {/* Your mood tracking content will go here */}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 10,
    width: '100%',
    height: '100%',
  },
  contentContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 15,
    padding: 20,
    margin: 10,
    width: '90%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});