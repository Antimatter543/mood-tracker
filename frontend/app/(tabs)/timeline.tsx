import { Text, View, StyleSheet } from "react-native";

export default function Timeline() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>This is the place that will deal with timelines</Text>
        </View>
    );
}

const styles = StyleSheet.create({

    container: {
      flex: 1,
      backgroundColor: '#25292e',
      alignItems: 'center',
      justifyContent: 'center',
    },

    text: {
      color: '#fff',
    },
  });