import { Text, View, StyleSheet } from "react-native";

export default function Social() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>This is the place that will deal with SOCIAL THINGS! WIP!</Text>
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