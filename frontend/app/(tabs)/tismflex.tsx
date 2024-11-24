// FOR LEARNING PURPOSES
import React from 'react';
import { View, Text } from 'react-native';

// Basic Flex Direction Example
export default function FlexExamples() {
    return (
        <>
            {/* Row Example */}
            <View style={{
                flexDirection: 'row',  // Main axis is horizontal
                height: 100,
                backgroundColor: '#333',
                gap: 10,  // Space between items
            }}>
                <View style={{width: 50, height: 50, backgroundColor: 'red'}} />
                <View style={{width: 50, height: 50, backgroundColor: 'blue'}} />
                <View style={{width: 50, height: 50, backgroundColor: 'green'}} />
            </View>

            {/* Column Example */}
            <View style={{
                flexDirection: 'column',  // Main axis is vertical
                height: 300,
                backgroundColor: '#444',
                gap: 10,
            }}>
                <View style={{width: 50, height: 50, backgroundColor: 'red'}} />
                <View style={{width: 50, height: 50, backgroundColor: 'blue'}} />
                <View style={{width: 50, height: 50, backgroundColor: 'green'}} />
            </View>

            {/* Flex Growing Example */}
            <View style={{
                height: 300,
                backgroundColor: '#555',
                gap: 10,
            }}>
                <View style={{flex: 1, backgroundColor: 'red'}} />    {/* Takes 1/6 */}
                <View style={{flex: 2, backgroundColor: 'blue'}} />   {/* Takes 2/6 */}
                <View style={{flex: 3, backgroundColor: 'green'}} />  {/* Takes 3/6 */}
            </View>
        </>
    );
}