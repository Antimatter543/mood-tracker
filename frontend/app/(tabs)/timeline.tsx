import MoodSelector from "@/components/Test";
import { Text, View, StyleSheet } from "react-native";

export default function Timeline() {

      // For moodselector scroller
      const handleMoodChange = (value: number) => {
        console.log("hi!!", value);
    };

    return (
        <View style={styles.container}>
            <Text style={styles.text}>This is the place that will deal with timelines</Text>
            <MoodSelector onValueChange={handleMoodChange} /> 
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